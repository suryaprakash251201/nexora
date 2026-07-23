import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import App from "./App";
import SharePage from "./components/SharePage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// Initialize accent theme from localStorage
const savedAccent = localStorage.getItem("accent-theme") || "midnight";
document.documentElement.dataset.theme = savedAccent;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
  },
});

// Public share pages are served at /s/<token> and do not require auth.
function Root() {
  const match = window.location.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
  if (match) {
    return <SharePage token={match[1]} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={["dark", "light"]}>
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
