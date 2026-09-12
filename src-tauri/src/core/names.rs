//! One way to name an application.
//!
//! Several subsystems need to decide whether two things are "the same
//! app": audio sessions roll up per executable, workspace restore pairs
//! saved windows with live ones, and the running-app filter matches
//! shell hosts by file name. They all key on the same string so a change
//! in one place cannot drift from another.

/// File name of a full path, lowercased.
///
/// Windows paths are case-insensitive and an app can be launched through
/// different casings or through a symlinked directory, so the file name
/// alone is both the most stable and the most forgiving key available.
pub fn exe_key(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase()
}

/// Strip `.exe` and capitalize, so `discord.exe` reads as `Discord`.
/// Used wherever an app gives us no friendlier name of its own.
pub fn display_name(exe: &str) -> String {
    let stem = exe_key(exe);
    let stem = stem.strip_suffix(".exe").unwrap_or(&stem);
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => stem.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_is_the_lowercased_file_name() {
        assert_eq!(exe_key(r"C:\Program Files\Discord\Discord.exe"), "discord.exe");
        assert_eq!(exe_key("Spotify.EXE"), "spotify.exe");
        assert_eq!(exe_key(r"D:/games/Game.exe"), "game.exe");
        assert_eq!(exe_key("bare"), "bare");
    }

    #[test]
    fn the_same_app_through_different_paths_shares_a_key() {
        assert_eq!(
            exe_key(r"C:\Users\a\AppData\Local\Discord\app-1.0\Discord.exe"),
            exe_key(r"D:\Portable\discord.exe")
        );
    }

    #[test]
    fn display_names_lose_the_extension_and_gain_a_capital() {
        assert_eq!(display_name("discord.exe"), "Discord");
        assert_eq!(display_name(r"C:\x\vlc.exe"), "Vlc");
        assert_eq!(display_name("noext"), "Noext");
    }
}
