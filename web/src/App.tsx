import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./api/client";
import Login from "./components/Login";
import Setup from "./components/Setup";
import Workspace from "./components/Workspace";
import type { User } from "./api/types";

export default function App() {
  const qc = useQueryClient();
  return (
    <>
      <div className="nexora-bg" aria-hidden="true" />
      <AppInner />
    </>
  );
}

function AppInner() {
  const qc = useQueryClient();
  const needsSetup = useQuery({ queryKey: ["needs-setup"], queryFn: () => get<{ configured: boolean }>("/auth/needs-setup") });
  const session = useQuery({ queryKey: ["session"], queryFn: () => get<{ user: User }>("/auth/session") });

  if (needsSetup.isLoading || session.isLoading) {
    return <div className="min-h-screen grid place-items-center text-content-muted">Loading…</div>;
  }

  if (!needsSetup.data?.configured) {
    return <Setup onSuccess={() => { qc.invalidateQueries(); }} />;
  }

  if (!session.data?.user) {
    return <Login onSuccess={() => { qc.invalidateQueries(); }} />;
  }

  return <Workspace user={session.data.user} />;
}

// Re-export for potential external use.
export async function logout() {
  await post("/auth/logout");
}
