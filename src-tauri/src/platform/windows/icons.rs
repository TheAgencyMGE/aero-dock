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

/// Return the cached PNG path for `target`, extracting it on first use.
/// Call from `spawn_blocking`.
pub fn ensure_icon(target: &str, cache_dir: &Path) -> AeroResult<PathBuf> {
    let key = path_key(target);
    let png_path = cache_dir.join(format!("{key}.png"));
    if png_path.exists() {
        return Ok(png_path);
    }
    std::fs::create_dir_all(cache_dir)?;

    let _com = ComApartment::new();
    let rgba = extract_rgba(target)?;
    rgba.save_with_format(&png_path, image::ImageFormat::Png)?;
    Ok(png_path)
}

fn extract_rgba(target: &str) -> AeroResult<image::RgbaImage> {
    let wide = to_wide(target);
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)? };
    let hbitmap: HBITMAP = unsafe {
        factory.GetImage(
            SIZE {
                cx: ICON_SIZE,
                cy: ICON_SIZE,
            },
            SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
        )?
    };
    let result = hbitmap_to_rgba(hbitmap);
    unsafe {
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    };
    result
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
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    // Bitmaps without an alpha channel come back with alpha 0 everywhere;
    // treat those as fully opaque instead of invisible.
    if pixels.chunks_exact(4).all(|px| px[3] == 0) {
        for px in pixels.chunks_exact_mut(4) {
            px[3] = 255;
        }
    }

    image::RgbaImage::from_raw(width as u32, height as u32, pixels)
        .ok_or_else(|| AeroError::other("icon pixel buffer size mismatch"))
}
