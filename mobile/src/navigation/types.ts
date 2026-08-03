import type { FileItem } from "../api/types";

export type RootStackParamList = {
  Main: undefined;
  Browser: { rootId: string; rootName: string; path?: string; initialItem?: FileItem };
  Preview: { item: FileItem; rootId: string };
  Admin: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: { focusSearch?: boolean; filter?: string } | undefined;
  Recents: { focusSearch?: boolean; filter?: string } | undefined;
  Settings: undefined;
};
