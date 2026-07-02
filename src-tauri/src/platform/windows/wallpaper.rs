//! Wallpaper color sync: read the current wallpaper path and extract a
//! vibrant accent color the theme engine can tint itself with.

use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

use super::util::from_wide;
use crate::core::{AeroError, AeroResult};

pub fn wallpaper_path() -> AeroResult<String> {
    let mut buf = [0u16; 512];
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )?
    };
    let path = from_wide(&buf);
    if path.is_empty() {
        return Err(AeroError::other("no wallpaper set"));
    }
    Ok(path)
}

/// Dominant vibrant color of the current wallpaper as `#rrggbb`.
/// Downsamples hard, buckets by hue, scores by saturation × mid-lightness,
/// and averages the winning bucket — cheap and good enough for tinting.
pub fn wallpaper_accent() -> AeroResult<String> {
    let path = wallpaper_path()?;
    // the active wallpaper is often TranscodedWallpaper with no
    // extension — detect the format from magic bytes, not the name
    let bytes = std::fs::read(&path)?;
    let img = image::load_from_memory(&bytes)?;
    let small = img.thumbnail(64, 64).to_rgb8();

    const BUCKETS: usize = 12;
    let mut sum = [[0f32; 4]; BUCKETS]; // r,g,b,weight per hue bucket

    for px in small.pixels() {
        let (r, g, b) = (px[0] as f32 / 255.0, px[1] as f32 / 255.0, px[2] as f32 / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        let d = max - min;
        if d < 0.03 {
            continue; // gray: no hue information
        }
        let s = d / (1.0 - (2.0 * l - 1.0).abs()).max(1e-5);
        let h = if max == r {
            ((g - b) / d).rem_euclid(6.0)
        } else if max == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        } / 6.0;
        let weight = s * (1.0 - (l - 0.5).abs() * 1.6).max(0.05);
        let bucket = ((h * BUCKETS as f32) as usize).min(BUCKETS - 1);
        sum[bucket][0] += r * weight;
        sum[bucket][1] += g * weight;
        sum[bucket][2] += b * weight;
        sum[bucket][3] += weight;
    }

    let best = sum
        .iter()
        .max_by(|a, b| a[3].total_cmp(&b[3]))
        .filter(|b| b[3] > 0.0)
        .ok_or_else(|| AeroError::other("wallpaper has no dominant hue"))?;

    let to_byte = |v: f32| ((v / best[3]).clamp(0.0, 1.0) * 255.0).round() as u8;
    Ok(format!(
        "#{:02x}{:02x}{:02x}",
        to_byte(best[0]),
        to_byte(best[1]),
        to_byte(best[2])
    ))
}
