import { createBrowserRouter, useParams } from "react-router-dom";
import App from "./App";
import SharePage from "./components/SharePage";

function SharePageRoute() {
  const { token } = useParams<{ token: string }>();
  return token ? <SharePage token={token} /> : null;
}

// We'll lazy load the main app layout so the public share page loads instantly
export const router = createBrowserRouter([
  {
    path: "/s/:token",
    element: <SharePageRoute />,
  },
  {
    path: "/*",
    element: <App />,
  }
]);
