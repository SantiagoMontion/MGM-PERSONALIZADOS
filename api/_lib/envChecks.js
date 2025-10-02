export const ENV_GROUPS = {
  SHOPIFY_ADMIN: [
    ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_SHOP'],
    'SHOPIFY_ADMIN_TOKEN',
  ],
  SHOPIFY_STOREFRONT: [
    ['SHOPIFY_STOREFRONT_DOMAIN', 'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_SHOP'],
    'SHOPIFY_STOREFRONT_TOKEN',
  ],
  SUPABASE_SERVICE: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE'],
};

function hasEnvValue(name) {
  const raw = process.env[name];
  if (raw == null) return false;
  if (typeof raw === 'string') return raw.trim() !== '';
  return true;
}

export function resolveEnvRequirements(...entries) {
  const resolved = [];
  for (const entry of entries.flat()) {
    if (!entry) continue;
    if (typeof entry === 'string' && ENV_GROUPS[entry]) {
      resolved.push(...ENV_GROUPS[entry]);
    } else {
      resolved.push(entry);
    }
  }
  return resolved;
}

export function collectMissingEnv(requirements = []) {
  const missing = [];
  for (const requirement of requirements) {
    if (!requirement) continue;
    if (Array.isArray(requirement)) {
      const satisfied = requirement.some((name) => hasEnvValue(name));
      if (!satisfied) {
        missing.push(requirement[0] || requirement.join('|'));
      }
      continue;
    }
    if (typeof requirement === 'string') {
      if (!hasEnvValue(requirement)) {
        missing.push(requirement);
      }
    }
  }
  return missing;
}

export default {
  ENV_GROUPS,
  resolveEnvRequirements,
  collectMissingEnv,
};
