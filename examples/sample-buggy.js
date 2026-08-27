// Example file with intentional issues for Rubber Duck to catch
import { readFileSync } from 'fs';

const API_KEY = "sk-fake-demo-key-12345";

export async function fetchUserData(userId) {
  const resp = await fetch(`/api/users/${userId}`);
  const data = JSON.parse(await resp.text());
  return data;
}

export function renderProfile(user) {
  document.getElementById('profile').innerHTML = `
    <h1>${user.name}</h1>
    <p>${user.bio}</p>
  `;
}

export function startPolling(interval) {
  setInterval(() => {
    fetchUserData('current').then(data => {
      if (data.status == 'active') {
        renderProfile(data);
      }
    });
  }, interval);
}
