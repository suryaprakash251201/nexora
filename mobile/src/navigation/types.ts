import type { FileItem } from "../api/types";

export type RootStackParamList = {
  Main: undefined;
  Browser: { rootId: string; rootName: string; path?: string; initialItem?: FileItem };
  Preview: { item: FileItem; rootId: string };
};

export type MainTabParamList = {
  Home: undefined;
  Recents: undefined;
  Settings: undefined;
};
