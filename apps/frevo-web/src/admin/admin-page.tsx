import { AdminModelsSection } from "./admin-models";

// The host's controls. The full screen arrives with the admin ticket; the
// link carries the secret as `/admin?k=<secret>`.
export function AdminPage() {
  const secret = new URLSearchParams(window.location.search).get("k");
  return (
    <main className="placeholder">
      <h1>Admin do bloco</h1>
      {secret ? (
        <AdminModelsSection secret={secret} />
      ) : (
        <p>Abra o link do admin que o servidor imprime ao subir.</p>
      )}
      <p>
        Veja a praça no <a href="/telao">telão</a>.
      </p>
    </main>
  );
}
