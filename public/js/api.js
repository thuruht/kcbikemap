export async function fetchFeatures() {
  const res = await fetch('/api/features');
  if (!res.ok) throw new Error('Failed to fetch features');
  return await res.json();
}

export async function createFeature(data) {
  const res = await fetch('/api/features', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create feature');
  return await res.json();
}

export async function createFeaturesBulk(features) {
  const res = await fetch('/api/features/bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ features })
  });
  if (!res.ok) throw new Error('Failed to create features bulk');
  return await res.json();
}

export async function updateFeature(id, data) {
  const res = await fetch(`/api/features/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update feature');
  return await res.json();
}

export async function fetchMe() {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return await res.json();
}

export async function assignUserRole(email, newRole) {
  const res = await fetch('/api/admin/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, newRole })
  });
  if (!res.ok) throw new Error('Failed to assign role');
  return await res.json();
}

export async function hideContent(type, id) {
  const res = await fetch('/api/moderation/hide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id })
  });
  if (!res.ok) throw new Error('Failed to hide content');
  return await res.json();
}

export async function updateProfile(data) {
  const res = await fetch('/api/me/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update profile');
  }
  return await res.json();
}

export async function uploadAvatar(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const res = await fetch('/api/me/avatar', {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error('Failed to upload avatar');
  return await res.json();
}

export async function fetchProfile(username) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error('Profile not found');
  return await res.json();
}
