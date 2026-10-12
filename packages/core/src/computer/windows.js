// Windows input through SendInput, from one long-running PowerShell process (compiling the helper once).
import { spawn } from 'node:child_process';
import { powerShellArgs } from '../windows.js';
import { windowsKey } from './keys.js';

const HELPER = String.raw`
using System; using System.Runtime.InteropServices;
public static class MindsInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  public static string Pos() { POINT p; GetCursorPos(out p); return p.x + " " + p.y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short VkKeyScan(char c);
  static void Send(INPUT i) { SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  public static void Mouse(uint flags, int data) { var i = new INPUT { type = 0 }; i.u.mi.dwFlags = flags; i.u.mi.mouseData = (uint)data; Send(i); }
  static readonly int[] Extended = { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5D };
  public static void Key(int vk, bool down) {
    var i = new INPUT { type = 1 }; i.u.ki.wVk = (ushort)vk;
    i.u.ki.dwFlags = (down ? 0u : 2u) | (Array.IndexOf(Extended, vk) >= 0 ? 1u : 0u); Send(i);
  }
  public static void CharKey(int c, bool down) { Key(VkKeyScan((char)c) & 0xff, down); }
  public static void Text(int[] units) {
    foreach (var u in units) foreach (var down in new[] { true, false }) {
      var i = new INPUT { type = 1 }; i.u.ki.wScan = (ushort)u; i.u.ki.dwFlags = 4u | (down ? 0u : 2u); Send(i);
    }
  }
}`;
const MOUSE = { left: [0x2, 0x4], right: [0x8, 0x10], middle: [0x20, 0x40] };

export class WindowsInput {
  #ps = null; #queue = []; #buf = '';

  open() {
    if (this.#ps) return this.ready;
    const ps = this.#ps = spawn('powershell.exe', powerShellArgs([
      "$ErrorActionPreference = 'Stop'",
      'Add-Type -AssemblyName System.Windows.Forms',
      `Add-Type -TypeDefinition @'\n${HELPER}\n'@`,
      '[MindsInput]::SetProcessDPIAware() | Out-Null',
      '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
      '[Console]::Out.WriteLine("ok $($b.Left) $($b.Top) $($b.Width) $($b.Height)")',
      'while ($null -ne ($line = [Console]::In.ReadLine())) { try { $r = Invoke-Expression $line; [Console]::Out.WriteLine("ok $r") } catch { [Console]::Out.WriteLine("err " + $_.Exception.Message) } }',
    ].join('\n')), { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (d) => {
      this.#buf += d;
      let i;
      while ((i = this.#buf.indexOf('\n')) !== -1) {
        const line = this.#buf.slice(0, i).trim(); this.#buf = this.#buf.slice(i + 1);
        const w = this.#queue.shift(); if (!w) continue;
        line.startsWith('ok') ? w.resolve(line.slice(2).trim()) : w.reject(new Error(line.replace(/^err\s*/, '') || 'Windows input failed'));
      }
    });
    const fail = (e) => { for (const w of this.#queue.splice(0)) w.reject(e); this.#ps = null; };
    ps.on('error', (e) => fail(new Error(`Could not start PowerShell: ${e.message}`)));
    ps.on('exit', () => fail(new Error('Windows input helper stopped.')));
    this.ready = new Promise((resolve, reject) => this.#queue.push({ resolve, reject })).then((line) => {
      const [left, top, width, height] = line.split(' ').map(Number);
      this.bounds = { left, top, width, height };
    });
    return this.ready;
  }

  /** Commands are built from numbers only, never from model text. */
  #cmd(line) {
    return new Promise((resolve, reject) => { this.#queue.push({ resolve, reject }); this.#ps.stdin.write(`${line}\n`); });
  }
  move(fx, fy) {
    const b = this.bounds;
    return this.#cmd(`[MindsInput]::SetCursorPos(${Math.round(b.left + fx * (b.width - 1))}, ${Math.round(b.top + fy * (b.height - 1))})`);
  }
  button(btn, down) { return this.#cmd(`[MindsInput]::Mouse(${MOUSE[btn][down ? 0 : 1]}, 0)`); }
  async scroll(dx, dy) {
    if (dy) await this.#cmd(`[MindsInput]::Mouse(${0x800}, ${-dy * 120})`);
    if (dx) await this.#cmd(`[MindsInput]::Mouse(${0x1000}, ${dx * 120})`);
  }
  key(key, down) {
    const k = windowsKey(key);
    return this.#cmd(k.vk != null ? `[MindsInput]::Key(${k.vk}, $${down})` : `[MindsInput]::CharKey(${k.char}, $${down})`);
  }
  async type(text) {
    const units = [...text.replace(/\r?\n/g, '\r')].flatMap((c) => [...c].map((_, i) => c.charCodeAt(i)));
    for (let i = 0; i < units.length; i += 200) await this.#cmd(`[MindsInput]::Text(@(${units.slice(i, i + 200).join(',')}))`);
  }
  async pointer() {
    const [x, y] = (await this.#cmd('[MindsInput]::Pos()')).split(' ').map(Number);
    const b = this.bounds;
    return { fx: (x - b.left) / (b.width - 1), fy: (y - b.top) / (b.height - 1) };
  }
  close() { this.#ps?.kill(); this.#ps = null; }
}
