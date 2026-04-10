import { useState } from "react";

export function useSession() {
  const [id] = useState(() => {
    let s = sessionStorage.getItem("tickit_session");
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem("tickit_session", s); }
    return s;
  });
  return id;
}
