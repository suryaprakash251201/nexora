import { createBrowserRouter, createHashRouter, useParams, isRouteErrorResponse, useRouteError } from "react-router";
import App from "./App";
import SharePage from "./components/SharePage";
import { isTauri as isTauriFn } from "./lib/desktop";

function SharePageRoute() {
  const { token } = useParams<{ token: string }>();
  return token ? <SharePage token={token} /> : null;
}

function RootErrorBoundary() {
  const error = useRouteError();
  let message = "An unexpected error occurred.";
  if (isRouteErrorResponse(error)) {
    message = error.statusText || String(error.status);
  } else if (error instanceof Error) {
    message = error.message;
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-content mb-3">Something went wrong</h1>
        <p className="text-content-muted text-sm mb-2">{message}</p>
        <p className="text-content-muted/50 text-xs mb-6">
          Try refreshing the page. If the problem persists, check the server logs.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2 rounded-lg bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

const routes = [
  {
    path: "/s/:token",
    element: <SharePageRoute />,
    errorElement: <RootErrorBoundary />,
  },
  {
    path: "/*",
    element: <App />,
    errorElement: <RootErrorBoundary />,
  }
];

// If running in Tauri Desktop, use HashRouter. Otherwise, use BrowserRouter for Web.
const isTauri = isTauriFn();
export const router = isTauri ? createHashRouter(routes) : createBrowserRouter(routes);
