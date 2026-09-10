/* ------------------------------------------------------------------
   Satang Checklist — Cross-device sync
   วิธีใช้: วางแท็ก <script> นี้ไว้ "ก่อน" สคริปต์หลักของหน้าเว็บ
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ===== 1. กรอกสองค่านี้จาก Supabase → Project Settings → API ===== */
  const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
  const SUPABASE_KEY = 'ncmwddsthwsclhgwptob';
  /* ================================================================ */

  const P = '__sync_';                    // คีย์ภายในของตัวซิงก์เอง
  const POLL_MS = 20000;                  // ดึงข้อมูลใหม่ทุก 20 วิ
  const PUSH_DELAY = 1500;                // รอ 1.5 วิหลังหยุดพิมพ์ค่อยส่ง

  /* ---------- รหัสห้อง: ใช้รหัสเดียวกันทุกเครื่อง ---------- */
  let room = localStorage.getItem(P + 'room');
  if (!room) {
    room = (prompt(
      'ใส่รหัสซิงก์ (ตั้งเองยาว ๆ เดาไม่ได้ แล้วใช้รหัสเดียวกันนี้ทุกเครื่อง)'
    ) || '').trim();
    if (!room) return;                    // ไม่ใส่ = ใช้แบบออฟไลน์ตามเดิม
    localStorage.setItem(P + 'room', room);
  }

  const HEADERS = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  };
  const ENDPOINT = SUPABASE_URL + '/rest/v1/snapshots';

  const getRev = () => Number(localStorage.getItem(P + 'rev') || 0);
  const setRev = (r) => rawSet.call(localStorage, P + 'rev', String(r));

  let applying = false;                   // กันลูปตอนกำลังเขียนข้อมูลที่ดึงมา
  let pushTimer = null;

  /* ---------- อ่าน/เขียนสถานะทั้งก้อน ---------- */
  function snapshot() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(P) !== 0) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  function apply(data) {
    applying = true;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf(P) !== 0 && !(k in data)) rawRemove.call(localStorage, k);
    }
    Object.keys(data).forEach(function (k) {
      rawSet.call(localStorage, k, data[k]);
    });
    applying = false;
  }

  /* ---------- ดักการเขียนของหน้าเว็บ ---------- */
  const rawSet = Storage.prototype.setItem;
  const rawRemove = Storage.prototype.removeItem;
  const rawClear = Storage.prototype.clear;

  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === localStorage && !applying && String(k).indexOf(P) !== 0) schedulePush();
  };
  Storage.prototype.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === localStorage && !applying && String(k).indexOf(P) !== 0) schedulePush();
  };
  Storage.prototype.clear = function () {
    const room_ = this === localStorage ? localStorage.getItem(P + 'room') : null;
    const rev_ = this === localStorage ? localStorage.getItem(P + 'rev') : null;
    rawClear.call(this);
    if (this === localStorage) {
      if (room_) rawSet.call(localStorage, P + 'room', room_);
      if (rev_) rawSet.call(localStorage, P + 'rev', rev_);
      if (!applying) schedulePush();
    }
  };

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  }

  /* ---------- ส่งขึ้นคลาวด์ ---------- */
  async function push() {
    try {
      const remote = await fetchRow();
      const rev = Math.max(getRev(), remote ? remote.rev : 0) + 1;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: Object.assign({ Prefer: 'resolution=merge-duplicates' }, HEADERS),
        body: JSON.stringify({ id: room, rev: rev, data: snapshot() })
      });
      if (res.ok) { setRev(rev); mark('ซิงก์แล้ว'); }
      else mark('ส่งไม่สำเร็จ');
    } catch (e) { mark('ออฟไลน์'); }
  }

  /* ---------- ดึงจากคลาวด์ ---------- */
  async function fetchRow() {
    const url = ENDPOINT + '?id=eq.' + encodeURIComponent(room) + '&select=rev,data';
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  }

  async function pull() {
    try {
      const remote = await fetchRow();
      if (!remote) return;
      if (remote.rev > getRev()) {
        apply(remote.data);
        setRev(remote.rev);
        mark('มีข้อมูลใหม่ กำลังโหลด…');
        setTimeout(function () { location.reload(); }, 300);
      } else {
        mark('ซิงก์แล้ว');
      }
    } catch (e) { mark('ออฟไลน์'); }
  }

  /* ---------- ป้ายสถานะมุมจอ ---------- */
  let badge;
  function mark(text) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText =
        'position:fixed;right:10px;bottom:10px;z-index:99999;padding:6px 10px;' +
        'font:12px/1.4 system-ui,sans-serif;border-radius:999px;opacity:.75;' +
        'background:rgba(0,0,0,.72);color:#fff;pointer-events:none';
      document.body.appendChild(badge);
    }
    badge.textContent = text;
  }

  /* ---------- เริ่มทำงาน ---------- */
  function start() {
    pull();
    setInterval(pull, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pull();
    });
    window.addEventListener('beforeunload', function () {
      if (pushTimer) { clearTimeout(pushTimer); push(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
