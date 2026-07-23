import type { FileItem } from "../api/types";

self.onmessage = (e: MessageEvent) => {
  const { items, filter, search } = e.data as { items: FileItem[], filter: string, search: string };

  let f = items;
  if (filter !== "all") {
    if (filter === "folders") f = f.filter((i) => i.is_dir);
    else if (filter === "documents") f = f.filter((i) => !i.is_dir && (i.mime.startsWith("text/") || ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key", "md", "txt", "rtf"].includes(i.extension.toLowerCase())));
    else if (filter === "images") f = f.filter((i) => i.mime.startsWith("image/"));
    else if (filter === "videos") f = f.filter((i) => i.mime.startsWith("video/"));
    else if (filter === "audio") f = f.filter((i) => i.mime.startsWith("audio/"));
    else if (filter === "archives") f = f.filter((i) => ["zip", "tar", "gz", "7z", "rar", "iso"].includes(i.extension.toLowerCase()));
  }
  
  if (search) {
    const s = search.toLowerCase();
    f = f.filter((i) => i.name.toLowerCase().includes(s));
  }

  self.postMessage(f);
};
