// Giới hạn RPM (request/phút) theo virtual key — sliding window 60 giây,
// giữ in-memory: mất khi restart chỉ nới lỏng tạm ~1 phút, chấp nhận được cho
// gateway local và tránh viết thêm bảng DB cho mỗi request.
//
// Chốt map bằng id của virtual key (ổn định kể cả khi raw key bị đổi).

const WINDOW_MS = 60_000;
const windows = new Map(); // keyId -> number[] (timestamps epoch ms)

/**
 * Nạp 1 request vào cửa sổ của keyId.
 * @returns {{ limited: boolean, retryAfterSec?: number }}
 */
export function consumeRateLimit(keyId, rpm, now = Date.now()) {
  const limit = Number(rpm);
  if (!Number.isFinite(limit) || limit <= 0) return { limited: false };

  const cutoff = now - WINDOW_MS;
  let stamps = windows.get(keyId);
  if (!Array.isArray(stamps)) {
    stamps = [];
    windows.set(keyId, stamps);
  }
  while (stamps.length && stamps[0] <= cutoff) stamps.shift();

  if (stamps.length >= limit) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((stamps[0] + WINDOW_MS - now) / 1000)),
    };
  }
  stamps.push(now);
  return { limited: false };
}

/** Dùng trong unit test để xoá trạng thái chung */
export function resetRateLimits() {
  windows.clear();
}
