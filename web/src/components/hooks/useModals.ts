import { useState, useMemo } from "react";
import type { FileItem } from "../../api/types";
import type { SidebarView } from "../Sidebar";

export function useModals() {
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [imageItem, setImageItem] = useState<FileItem | null>(null);
  const [videoItem, setVideoItem] = useState<FileItem | null>(null);
  const [prevView, setPrevView] = useState<SidebarView>("files");
  const [editItem, setEditItem] = useState<FileItem | null>(null);
  const [shareItem, setShareItem] = useState<FileItem | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: FileItem } | null>(null);
  const [ctxPlaylist, setCtxPlaylist] = useState<{ x: number; y: number; items: FileItem[] } | null>(null);
  const [menu, setMenu] = useState<{ kind: string; item?: FileItem } | null>(null);
  const [rootModal, setRootModal] = useState(false);
  const [playlistModal, setPlaylistModal] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [tagPicker, setTagPicker] = useState<{ rootId: string; paths: string[] } | null>(null);

  const isModalOpen = useMemo(
    () => !!(preview || imageItem || editItem || shareItem || menu || rootModal || playlistModal || ctx || ctxPlaylist || tagPicker),
    [preview, imageItem, editItem, shareItem, menu, rootModal, playlistModal, ctx, ctxPlaylist, tagPicker]
  );

  return {
    // Preview
    preview, setPreview,
    imageItem, setImageItem,
    videoItem, setVideoItem,
    prevView, setPrevView,
    // Editors
    editItem, setEditItem,
    shareItem, setShareItem,
    // Context menus
    ctx, setCtx,
    ctxPlaylist, setCtxPlaylist,
    // Action menus
    menu, setMenu,
    rootModal, setRootModal,
    playlistModal, setPlaylistModal,
    playlistName, setPlaylistName,
    commandPaletteOpen, setCommandPaletteOpen,
    // Tags
    tagPicker, setTagPicker,
    // Derived
    isModalOpen,
  };
}
