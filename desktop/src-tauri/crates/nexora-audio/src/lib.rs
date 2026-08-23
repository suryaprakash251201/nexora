//! nexora-audio — native audio playback engine for the Nexora Tauri desktop
//! client.
//!
//! Layered, each piece independently testable:
//!
//! 1. [`http_source::HttpRangeReader`] — an `io::Read + io::Seek` over HTTP
//!    Range requests with a bounded chunk cache (this crate's foundation).
//! 2. `decoder` (feature `decode`) — symphonia demux/decode over (1).
//! 3. `output` (feature `output`) — rodio/cpal sink to the OS mixer (WASAPI on
//!    Windows).
//!
//! The Tauri IPC layer lives in the parent `nexora-desktop` crate and drives
//! this one; nothing here knows about Tauri.

pub mod http_source;

pub use http_source::{HttpRangeConfig, HttpRangeReader, HttpSourceError};
