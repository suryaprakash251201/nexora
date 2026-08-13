import type { FileItem, Playlist } from "../api/types";

export type RootStackParamList = {
  Main: undefined;
  Browser: { rootId: string; rootName: string; path?: string; initialItem?: FileItem };
  Preview: { item: FileItem; rootId: string };
  Playlist: { playlist: Playlist };
  Category: { kind: string; title: string };
  Liked: undefined;
  Admin: undefined;
  Favorites: undefined;
  Trash: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: { focusSearch?: boolean; filter?: string } | undefined;
  Recents: { focusSearch?: boolean; filter?: string } | undefined;
  Settings: undefined;
};
