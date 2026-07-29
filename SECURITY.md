# Security Policy

## Supported Versions

We follow [Semantic Versioning](https://semver.org/). The latest stable release
receives security updates. Older versions may receive critical fixes on a
best-effort basis.

| Version   | Supported          |
|-----------|--------------------|
| 1.x.x     | :white_check_mark: |
| < 1.0     | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them directly to the maintainers:

- **GitHub Security Advisories**: Use the ["Report a vulnerability"](https://github.com/suryaprakash251201/nexora/security/advisories/new) tab in the repository's Security section.
- **Email**: For sensitive or critical issues, contact the maintainers directly (see repository profile).

You should receive an acknowledgement within **48 hours**. We will keep you
informed of the progress towards a fix and coordinated disclosure.

### What to include

- A clear description of the issue and its impact
- Steps to reproduce the vulnerability
- Affected versions and configurations
- Any potential mitigations you've identified

## Security Features

- **Password hashing**: Argon2id (memory-hard, resistant to GPU/ASIC attacks)
- **Session tokens**: SHA-256 hashed before storage; raw tokens never persisted
- **CSRF protection**: Double-submit cookie pattern with SameSite=Strict cookies
- **Rate limiting**: Per-client-IP token-bucket limiter on auth endpoints
- **Login lockout**: Exponential backoff after failed attempts
- **Path traversal prevention**: Server-side validation of all file paths
- **SQL injection**: All queries use parameterized placeholders
- **Security headers**: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **TOTP support**: Optional two-factor authentication
- **CORS**: Configurable; enabled by default for desktop/Tailscale clients

## Security Best Practices for Deployments

1. **Enable HTTPS** in production (use a reverse proxy like Caddy or nginx)
2. **Set `NEXORA_SECURE_COOKIES=true`** when HTTPS is enabled
3. **Configure `NEXORA_CORS_ORIGINS`** to restrict cross-origin access
4. **Set `NEXORA_SESSION_SECRET`** to a random, unique value
5. **Use `NEXORA_ALLOWED_MIME`** to restrict upload file types
6. **Regularly update** the Docker image or binary to receive security patches
7. **Enable Tailscale Auth** (`NEXORA_TAILSCALE_AUTH=true`) for zero-trust access

## Disclosure Policy

We follow a [Coordinated Disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
model. We ask that you:
- Allow us a reasonable time to fix and release a patch
- Avoid public disclosure until we have published a fix
- Do not exploit the vulnerability beyond demonstrating proof of concept

## Acknowledgments

We appreciate the security research community helping keep Nexora safe.
