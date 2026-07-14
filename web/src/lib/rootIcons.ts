import {
  HardDrive,
  Folder,
  Music,
  Image,
  Film,
  Archive,
  Database,
  Cloud,
  Server,
  BookOpen,
  Boxes,
  Disc,
  Library,
  Camera,
  FileVideo,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

// Set of icons an admin can assign to a storage root.
export const ROOT_ICONS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: "hard-drive", icon: HardDrive, label: "Drive" },
  { name: "folder", icon: Folder, label: "Folder" },
  { name: "folder-open", icon: FolderOpen, label: "Open folder" },
  { name: "music", icon: Music, label: "Music" },
  { name: "image", icon: Image, label: "Images" },
  { name: "film", icon: Film, label: "Videos" },
  { name: "file-video", icon: FileVideo, label: "Media" },
  { name: "camera", icon: Camera, label: "Photos" },
  { name: "archive", icon: Archive, label: "Archive" },
  { name: "database", icon: Database, label: "Database" },
  { name: "cloud", icon: Cloud, label: "Cloud" },
  { name: "server", icon: Server, label: "Server" },
  { name: "boxes", icon: Boxes, label: "Storage" },
  { name: "disc", icon: Disc, label: "Disc" },
  { name: "library", icon: Library, label: "Library" },
  { name: "book-open", icon: BookOpen, label: "Books" },
];

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ROOT_ICONS.map((i) => [i.name, i.icon])
);

export function rootIcon(name?: string): LucideIcon {
  return (name && ICON_MAP[name]) || HardDrive;
}
