export async function apiGet(path: string) {
  const urlAPi = 'https://node-dummy-roles-and-permissions.onrender.com';

  const url = `${urlAPi}${path}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("Error en la API");
  }

  return res.json();
}
