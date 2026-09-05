//! High-resolution icon extraction. `IShellItemImageFactory::GetImage`
//! yields the same 256px assets Explorer uses; we convert the returned
//! HBITMAP to RGBA and store PNGs in an on-disk cache, keyed by target
//! path hash. The WebView loads them over the asset protocol, so each
//! icon crosses IPC exactly zero times.

use std::path::{Path, PathBuf};

use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};

use super::util::{path_key, to_wide};
use crate::core::{AeroError, AeroResult};
use crate::platform::ComApartment;

const ICON_SIZE: i32 = 256;

/// Bump when the pixels a given path produces change, so upgrades do not
/// keep serving icons rendered by the previous rules. v2 added the
/// normalisation pass in `normalize_icon`.
const CACHE_VERSION: u32 = 2;

/// Return the cached PNG path for `target`, extracting it on first use.
/// Call from `spawn_blocking`.
pub fn ensure_icon(target: &str, cache_dir: &Path) -> AeroResult<PathBuf> {
    let key = path_key(target);
    let png_path = cache_dir.join(format!("{key}-v{CACHE_VERSION}.png"));
    if png_path.exists() {
        return Ok(png_path);
    }
    std::fs::create_dir_all(cache_dir)?;

    let _com = ComApartment::new();
    let rgba = normalize_icon(extract_rgba(target)?);
    rgba.save_with_format(&png_path, image::ImageFormat::Png)?;
    Ok(png_path)
}

fn extract_rgba(target: &str) -> AeroResult<image::RgbaImage> {
    let wide = to_wide(target);
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)? };
    let size = SIZE {
        cx: ICON_SIZE,
        cy: ICON_SIZE,
    };
    // ICONONLY fails for some shell items (known folders with custom
    // icons, e.g. Downloads); fall back to the general image path.
    let hbitmap: HBITMAP = unsafe {
        match factory.GetImage(size, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK) {
            Ok(h) => h,
            Err(_) => factory.GetImage(size, SIIGBF_BIGGERSIZEOK)?,
        }
    };
    let result = hbitmap_to_rgba(hbitmap);
    unsafe {
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    };
    result
}

/// Content is considered "small" below this fraction of the canvas, at
/// which point the icon is cropped to its drawn pixels and scaled up.
const SMALL_CONTENT_RATIO: f32 = 0.62;

/// Bounding box of the non-transparent pixels, as (x0, y0, x1, y1) with
/// the far edges exclusive. `None` when the image is fully transparent.
fn alpha_bounds(img: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = img.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    for (x, y, px) in img.enumerate_pixels() {
        if px.0[3] > 8 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    (x1 > x0 && y1 > y0).then_some((x0, y0, x1, y1))
}

/// Centre an image on a transparent square canvas of `side` pixels.
fn pad_to_square(img: &image::RgbaImage, side: u32) -> image::RgbaImage {
    let (w, h) = img.dimensions();
    let mut out = image::RgbaImage::from_pixel(side, side, image::Rgba([0, 0, 0, 0]));
    let ox = (side.saturating_sub(w)) / 2;
    let oy = (side.saturating_sub(h)) / 2;
    image::imageops::replace(&mut out, img, ox as i64, oy as i64);
    out
}

/// Give every icon the same optical weight.
///
/// Apps that ship only a 16 or 32 px resource (Core Temp is the usual
/// example) come back as a small drawing marooned in the middle of the
/// requested canvas, so the dock would render a postage stamp on a big
/// tile. Crop those to their drawn pixels first. Non-square icons are
/// padded rather than stretched, so the aspect ratio survives whatever
/// size the dock is set to.
pub fn normalize_icon(img: image::RgbaImage) -> image::RgbaImage {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return img;
    }
    let Some((x0, y0, x1, y1)) = alpha_bounds(&img) else {
        return img; // fully transparent, nothing to measure
    };

    let (cw, ch) = (x1 - x0, y1 - y0);
    let ratio = cw.max(ch) as f32 / w.max(h) as f32;

    // Only crop when the drawing is genuinely marooned. Well-formed icons
    // keep the padding their designer chose.
    let content = if ratio < SMALL_CONTENT_RATIO {
        image::imageops::crop_imm(&img, x0, y0, cw, ch).to_image()
    } else {
        img
    };

    let (cw, ch) = content.dimensions();
    let square = if cw == ch {
        content
    } else {
        pad_to_square(&content, cw.max(ch))
    };

    if square.width() == ICON_SIZE as u32 {
        square
    } else {
        image::imageops::resize(
            &square,
            ICON_SIZE as u32,
            ICON_SIZE as u32,
            image::imageops::FilterType::Lanczos3,
        )
    }
}

fn hbitmap_to_rgba(hbitmap: HBITMAP) -> AeroResult<image::RgbaImage> {
    let mut bmp = BITMAP::default();
    let got = unsafe {
        GetObjectW(
            HGDIOBJ(hbitmap.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut BITMAP as *mut _),
        )
    };
    if got == 0 {
        return Err(AeroError::other("GetObjectW failed on icon bitmap"));
    }
    let (width, height) = (bmp.bmWidth, bmp.bmHeight);
    if width <= 0 || height <= 0 {
        return Err(AeroError::other("icon bitmap has invalid dimensions"));
    }

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // negative = top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
    let hdc = unsafe { GetDC(None) };
    let lines = unsafe {
        GetDIBits(
            hdc,
            hbitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe { ReleaseDC(None, hdc) };
    if lines == 0 {
        return Err(AeroError::other("GetDIBits failed on icon bitmap"));
    }

    // BGRA -> RGBA in place
    let (rgba, _) = pixels.as_chunks_mut::<4>();
    for px in rgba {
        px.swap(0, 2);
    }
    // Bitmaps without an alpha channel come back with alpha 0 everywhere;
    // treat those as fully opaque instead of invisible.
    let (rgba, _) = pixels.as_chunks::<4>();
    if rgba.iter().all(|px| px[3] == 0) {
        let (rgba, _) = pixels.as_chunks_mut::<4>();
        for px in rgba {
            px[3] = 255;
        }
    }

    image::RgbaImage::from_raw(width as u32, height as u32, pixels)
        .ok_or_else(|| AeroError::other("icon pixel buffer size mismatch"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Transparent canvas with an opaque square drawn at (x, y).
    fn canvas(side: u32, x: u32, y: u32, w: u32, h: u32) -> image::RgbaImage {
        let mut img = image::RgbaImage::from_pixel(side, side, image::Rgba([0, 0, 0, 0]));
        for yy in y..(y + h) {
            for xx in x..(x + w) {
                img.put_pixel(xx, yy, image::Rgba([10, 120, 220, 255]));
            }
        }
        img
    }

    #[test]
    fn alpha_bounds_finds_the_drawn_region() {
        let img = canvas(64, 20, 24, 8, 10);
        assert_eq!(alpha_bounds(&img), Some((20, 24, 28, 34)));
    }

    #[test]
    fn alpha_bounds_is_none_when_empty() {
        let img = image::RgbaImage::from_pixel(32, 32, image::Rgba([0, 0, 0, 0]));
        assert_eq!(alpha_bounds(&img), None);
    }

    #[test]
    fn tiny_icon_is_cropped_and_scaled_up() {
        // a 16px drawing marooned on a 256px canvas, the Core Temp case
        let img = canvas(256, 120, 120, 16, 16);
        let out = normalize_icon(img);
        assert_eq!(out.dimensions(), (ICON_SIZE as u32, ICON_SIZE as u32));
        // after cropping, the drawing fills the canvas, so the corners
        // are now opaque rather than empty padding
        assert!(out.get_pixel(4, 4).0[3] > 8, "content should reach the edges");
    }

    #[test]
    fn well_formed_icon_keeps_its_padding() {
        // content covers most of the canvas already, so no crop
        let img = canvas(256, 8, 8, 240, 240);
        let out = normalize_icon(img);
        assert_eq!(out.dimensions(), (ICON_SIZE as u32, ICON_SIZE as u32));
        assert_eq!(out.get_pixel(1, 1).0[3], 0, "original padding should survive");
    }

    #[test]
    fn non_square_icon_is_padded_not_stretched() {
        // 200x100 of content: padding keeps the 2:1 shape inside a square
        let mut img = image::RgbaImage::from_pixel(256, 256, image::Rgba([0, 0, 0, 0]));
        for y in 78..178 {
            for x in 28..228 {
                img.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
            }
        }
        let out = normalize_icon(img);
        assert_eq!(out.dimensions(), (ICON_SIZE as u32, ICON_SIZE as u32));
        // top and bottom stay empty, so the shape was not stretched to fill
        assert_eq!(out.get_pixel(128, 2).0[3], 0);
        assert_eq!(out.get_pixel(128, 253).0[3], 0);
        // and the middle is still drawn
        assert!(out.get_pixel(128, 128).0[3] > 8);
    }

    #[test]
    fn fully_transparent_icon_is_left_alone() {
        let img = image::RgbaImage::from_pixel(48, 48, image::Rgba([0, 0, 0, 0]));
        let out = normalize_icon(img);
        assert_eq!(out.dimensions(), (48, 48));
    }

    #[test]
    fn extracts_folder_icon() {
        let dir = std::env::temp_dir().join("aero-icon-test");
        let result = ensure_icon(r"C:\Windows", &dir);
        assert!(result.is_ok(), "folder icon failed: {:?}", result.err());
    }

    #[test]
    fn extracts_exe_icon() {
        let dir = std::env::temp_dir().join("aero-icon-test");
        let result = ensure_icon(r"C:\Windows\System32\notepad.exe", &dir);
        assert!(result.is_ok(), "exe icon failed: {:?}", result.err());
    }
}
