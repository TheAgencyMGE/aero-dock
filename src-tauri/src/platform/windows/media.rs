//! Now playing, for the music widget.
//!
//! Windows keeps a system-wide list of media sessions, the same one the
//! volume flyout shows, so this works with anything that registers: media
//! keys, browsers, Spotify, the built-in player. There is no per-app
//! integration to write and nothing to configure.
//!
//! Everything here is best effort. Nothing is playing most of the time,
//! and a session can disappear between asking for it and reading it, so
//! every step degrades to "nothing playing" rather than an error.

use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// False when nothing has a media session at all.
    pub active: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    /// Which app owns the session, for the label under the title.
    pub source: String,
}

async fn current_session() -> Option<Session> {
    let manager = SessionManager::RequestAsync().ok()?.await.ok()?;
    manager.GetCurrentSession().ok()
}

/// What is playing right now, if anything.
pub async fn now_playing() -> NowPlaying {
    let Some(session) = current_session().await else {
        return NowPlaying::default();
    };

    let mut out = NowPlaying {
        active: true,
        ..Default::default()
    };

    let props = match session.TryGetMediaPropertiesAsync() {
        Ok(op) => op.await.ok(),
        Err(_) => None,
    };
    if let Some(props) = props {
        out.title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        out.artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        out.album = props
            .AlbumTitle()
            .map(|s| s.to_string())
            .unwrap_or_default();
    }

    if let Ok(info) = session.GetPlaybackInfo() {
        out.playing = info
            .PlaybackStatus()
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);
    }

    out.source = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();

    // A session with no title is a player sitting idle, which reads
    // better as nothing playing than as a blank card.
    if out.title.trim().is_empty() {
        out.active = false;
    }

    out
}

/// What the transport buttons can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
}

/// Send a transport command to whatever owns the session. Returns false
/// when there is nothing to control or the app refused.
pub async fn control(action: MediaAction) -> bool {
    let Some(session) = current_session().await else {
        return false;
    };
    let op = match action {
        MediaAction::PlayPause => session.TryTogglePlayPauseAsync(),
        MediaAction::Next => session.TrySkipNextAsync(),
        MediaAction::Previous => session.TrySkipPreviousAsync(),
    };
    match op {
        Ok(op) => op.await.unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_now_playing_never_fails_whatever_the_machine_is_doing() {
        let n = tauri::async_runtime::block_on(now_playing());
        // Nothing may be playing on a build machine, and something may be
        // playing on a desktop. Both are fine; the invariant is that an
        // inactive result carries no half-filled fields to render.
        if !n.active {
            assert!(n.title.is_empty(), "inactive sessions have no title");
        }
    }

    #[test]
    fn actions_parse_from_the_frontend_spelling() {
        for (text, want) in [
            (r#""playpause""#, MediaAction::PlayPause),
            (r#""next""#, MediaAction::Next),
            (r#""previous""#, MediaAction::Previous),
        ] {
            let got: MediaAction = serde_json::from_str(text).expect(text);
            assert_eq!(got, want);
        }
    }
}
