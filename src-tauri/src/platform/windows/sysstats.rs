//! CPU and memory for the system stats widget.
//!
//! CPU load is not a number Windows hands out; it is a ratio between two
//! samples of how much time the machine spent idle. The previous sample
//! is kept here so each call reports the load since the last one, which
//! is what a widget polling on an interval actually wants.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::SystemInformation::{
    GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
};
use windows::Win32::System::Threading::GetSystemTimes;

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoad {
    /// 0..=100, averaged over the gap since the previous reading.
    pub cpu_percent: u8,
    /// 0..=100 of physical memory in use.
    pub memory_percent: u8,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    /// Seconds since the machine booted.
    pub uptime_seconds: u64,
}

/// The previous CPU sample, packed so it can live in atomics rather than
/// a lock: reading stats must never block the UI thread.
static LAST_IDLE: AtomicU64 = AtomicU64::new(0);
static LAST_BUSY: AtomicU64 = AtomicU64::new(0);

fn filetime_to_u64(ft: FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
}

/// Load since the previous call. The first call after start has no
/// previous sample, so it reports zero rather than a made-up figure.
pub fn read() -> SystemLoad {
    let mut out = SystemLoad::default();

    unsafe {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok() {
            let idle_t = filetime_to_u64(idle);
            // kernel time includes idle time, so busy is everything minus idle
            let total = filetime_to_u64(kernel) + filetime_to_u64(user);
            let busy_t = total.saturating_sub(idle_t);

            let prev_idle = LAST_IDLE.swap(idle_t, Ordering::Relaxed);
            let prev_busy = LAST_BUSY.swap(busy_t, Ordering::Relaxed);

            if prev_idle != 0 || prev_busy != 0 {
                let d_idle = idle_t.saturating_sub(prev_idle);
                let d_busy = busy_t.saturating_sub(prev_busy);
                if let Some(pct) = (d_busy * 100).checked_div(d_idle + d_busy) {
                    out.cpu_percent = pct.min(100) as u8;
                }
            }
        }

        let mut mem = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut mem).is_ok() {
            out.memory_percent = mem.dwMemoryLoad.min(100) as u8;
            out.memory_total_mb = mem.ullTotalPhys / (1024 * 1024);
            out.memory_used_mb =
                (mem.ullTotalPhys.saturating_sub(mem.ullAvailPhys)) / (1024 * 1024);
        }

        out.uptime_seconds = GetTickCount64() / 1000;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reported_numbers_stay_inside_their_ranges() {
        // first call primes the CPU baseline
        let _ = read();
        std::thread::sleep(std::time::Duration::from_millis(120));
        let s = read();
        assert!(s.cpu_percent <= 100, "cpu {}", s.cpu_percent);
        assert!(s.memory_percent <= 100, "mem {}", s.memory_percent);
        assert!(s.memory_total_mb > 0, "a machine has some memory");
        assert!(
            s.memory_used_mb <= s.memory_total_mb,
            "used {} of {}",
            s.memory_used_mb,
            s.memory_total_mb
        );
    }

    #[test]
    fn uptime_moves_forward() {
        let a = read().uptime_seconds;
        assert!(a > 0, "the machine has been up for some time");
    }
}
