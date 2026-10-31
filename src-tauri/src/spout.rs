//! Saída Spout (DK-102, desligada por padrão): captura a janela do telão com Windows Graphics
//! Capture, copia GPU→GPU para uma textura DX11 compartilhada e publica como sender Spout,
//! escrevendo o protocolo do Spout2 (BSD-2-Clause, © Lynn Jarvis; ver docs/CREDITOS.md) sem o
//! SDK em C++. Nada passa pela CPU nem toca na thread de áudio.
//!
//! Protocolo (SPOUTSDK/SpoutGL, master de leadedge/Spout2):
//! - `SpoutSenderNames` (64 × 256 bytes, lista terminada por nome vazio) e `ActiveSenderName`
//!   (256 bytes), cada mapa guardado pelo mutex `<mapa>_mutex` (SpoutSharedMemory.cpp:
//!   Create/Open/Lock, espera de 67 ms);
//! - mapa com o nome do sender: `SharedTextureInfo` de 280 bytes (SpoutSenderNames.cpp:
//!   UpdateSender/SetSenderInfo): handle legado de 32 bits, largura, altura, formato DXGI, uso 0,
//!   descrição (caminho do executável), partnerId 0;
//! - mutex `<nome>_SpoutAccessMutex` em volta da cópia e semáforo `<nome>_Count_Semaphore`
//!   (inicial 1, máximo LONG_MAX) com Wait(0) + Release(2) por quadro (SpoutFrameCount.cpp:
//!   CreateAccessMutex/CheckAccess/AllowAccess/EnableFrameCount/SetNewFrame; SpoutDX.cpp:
//!   SendTexture copia, dá Flush e conta o quadro dentro do lock).

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub frames: u64,
    pub last_error: Option<String>,
}

/// Sender em execução (thread de captura). `stop` (ou Drop) encerra e libera tudo.
pub struct Spout {
    hwnd: isize,
    name: String,
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<Status>>,
    thread: Option<JoinHandle<()>>,
}

impl Spout {
    /// Começa a capturar a janela `hwnd` e publicar como `name`. Falhas (Windows sem WGC,
    /// janela fechada, GPU) desligam o sender e ficam em `status().last_error`; o telão segue.
    pub fn start(hwnd: isize, name: String) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let status = Arc::new(Mutex::new(Status { running: true, name: name.clone(), ..Default::default() }));
        let (s, st, n) = (stop.clone(), status.clone(), name.clone());
        let thread = std::thread::Builder::new()
            .name("spout".into())
            .spawn(move || {
                #[cfg(windows)]
                let r = win::run(hwnd, &name, &s, &st);
                #[cfg(not(windows))]
                let r: Result<(), String> = Err("Spout só existe no Windows".into());
                let mut g = st.lock().unwrap();
                g.running = false;
                g.fps = 0.0;
                if let Err(e) = r {
                    g.last_error = Some(e);
                }
            })
            .ok();
        Self { hwnd, name: n, stop, status, thread }
    }

    /// Para e liga de novo com a mesma janela e o mesmo nome: depois de mover o telão para outro
    /// monitor, o device é recriado no adaptador do monitor novo. O stop termina antes (o nome sai
    /// da lista), então o sender volta com o mesmo nome, não como `nome_1`.
    pub fn restart(&mut self) {
        self.stop();
        *self = Self::start(self.hwnd, self.name.clone());
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Spout {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Nome de sender aceitável: 1–200 caracteres visíveis (o Spout guarda 256 bytes com o NUL).
pub fn check_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n.len() > 200 || n.chars().any(|c| c.is_control()) {
        return Err("Nome do Spout: 1 a 200 caracteres, sem controle".into());
    }
    Ok(n.to_string())
}

#[cfg(windows)]
pub mod win {
    use super::*;
    use windows::core::{factory, Interface, PCSTR};
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE, HWND, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN};
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter, IDXGIDevice, IDXGIFactory1, IDXGIResource};
    use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::System::Memory::{CreateFileMappingA, MapViewOfFile, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE};
    use windows::Win32::System::Threading::{CreateMutexA, CreateSemaphoreA, ReleaseMutex, ReleaseSemaphore, WaitForSingleObject};
    use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    pub const NAME_LEN: usize = 256;
    pub const MAX_SENDERS: usize = 64;
    pub const INFO_SIZE: usize = 280;
    const LOCK_MS: u32 = 67; // o mesmo tempo do SDK

    fn cstr(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    }

    /// Objeto do kernel nomeado (handle que fecha sozinho).
    struct Owned(HANDLE);
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    /// Mapa de memória nomeado + o mutex `<nome>_mutex` que o Spout usa para guardá-lo.
    struct Map {
        _h: Owned,
        view: MEMORY_MAPPED_VIEW_ADDRESS,
        len: usize,
        mutex: Owned,
    }

    impl Map {
        fn open(name: &str, len: usize) -> windows::core::Result<Self> {
            unsafe {
                let n = cstr(name);
                let h = Owned(CreateFileMappingA(INVALID_HANDLE_VALUE, None, PAGE_READWRITE, 0, len as u32, PCSTR(n.as_ptr()))?);
                let view = MapViewOfFile(h.0, FILE_MAP_ALL_ACCESS, 0, 0, len);
                if view.Value.is_null() {
                    return Err(windows::core::Error::from_thread());
                }
                let m = cstr(&format!("{name}_mutex"));
                let mutex = Owned(CreateMutexA(None, false, PCSTR(m.as_ptr()))?);
                Ok(Self { _h: h, view, len, mutex })
            }
        }

        /// Roda `f` com o mapa travado (como SpoutSharedMemory::Lock/Unlock). Sem o lock em 67 ms,
        /// segue assim mesmo: melhor um nome escrito fora de hora que um sender que nunca aparece.
        fn with<R>(&mut self, f: impl FnOnce(&mut [u8]) -> R) -> R {
            unsafe {
                let locked = WaitForSingleObject(self.mutex.0, LOCK_MS) == WAIT_OBJECT_0;
                let r = f(std::slice::from_raw_parts_mut(self.view.Value as *mut u8, self.len));
                if locked {
                    let _ = ReleaseMutex(self.mutex.0);
                }
                r
            }
        }
    }

    impl Drop for Map {
        fn drop(&mut self) {
            unsafe {
                let _ = UnmapViewOfFile(self.view);
            }
        }
    }

    pub fn read_names(list: &[u8]) -> Vec<String> {
        list.chunks(NAME_LEN)
            .take_while(|c| c[0] != 0)
            .map(|c| String::from_utf8_lossy(&c[..c.iter().position(|&b| b == 0).unwrap_or(NAME_LEN)]).into_owned())
            .collect()
    }

    fn write_names(list: &mut [u8], names: &[String]) {
        list.fill(0);
        for (i, n) in names.iter().take(MAX_SENDERS - 1).enumerate() {
            let b = n.as_bytes();
            list[i * NAME_LEN..i * NAME_LEN + b.len().min(NAME_LEN - 1)].copy_from_slice(&b[..b.len().min(NAME_LEN - 1)]);
        }
    }

    fn texture(dev: &ID3D11Device, w: u32, h: u32, usage: D3D11_USAGE, bind: u32, cpu: u32, misc: u32) -> windows::core::Result<ID3D11Texture2D> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: usage,
            BindFlags: bind,
            CPUAccessFlags: cpu,
            MiscFlags: misc,
        };
        let mut t = None;
        unsafe { dev.CreateTexture2D(&desc, None, Some(&mut t))? };
        Ok(t.unwrap())
    }

    /// Sender Spout registrado: textura compartilhada + mapas + mutex de acesso + contador.
    /// Drop tira o nome da lista e fecha tudo (como SpoutDX::ReleaseSender).
    pub struct Sender {
        pub name: String,
        pub width: u32,
        pub height: u32,
        tex: ID3D11Texture2D,
        names: Map,
        _active: Map, // aberto enquanto o sender existe (o mapa some quando o último handle fecha)
        info: Map,
        access: Owned,
        count: Owned,
    }

    impl Sender {
        /// Registra `name` (se já existe na lista, vira `name_1`, `name_2`… como o SDK faz).
        pub fn new(dev: &ID3D11Device, name: &str, w: u32, h: u32) -> windows::core::Result<Self> {
            let mut names = Map::open("SpoutSenderNames", MAX_SENDERS * NAME_LEN)?;
            let name = names.with(|list| {
                let mut all = read_names(list);
                let mut n = name.to_string();
                let mut k = 1;
                while all.contains(&n) {
                    n = format!("{name}_{k}");
                    k += 1;
                }
                all.push(n.clone());
                write_names(list, &all);
                n
            });
            let mut active = Map::open("ActiveSenderName", NAME_LEN)?;
            active.with(|b| write_names(b, std::slice::from_ref(&name)));
            let info = Map::open(&name, INFO_SIZE)?;
            let a = cstr(&format!("{name}_SpoutAccessMutex"));
            let c = cstr(&format!("{name}_Count_Semaphore"));
            let (access, count) = unsafe {
                (Owned(CreateMutexA(None, false, PCSTR(a.as_ptr()))?), Owned(CreateSemaphoreA(None, 1, i32::MAX, PCSTR(c.as_ptr()))?))
            };
            let bind = (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32;
            let tex = texture(dev, w, h, D3D11_USAGE_DEFAULT, bind, 0, D3D11_RESOURCE_MISC_SHARED.0 as u32)?;
            let mut s = Self { name, width: w, height: h, tex, names, _active: active, info, access, count };
            s.write_info()?;
            Ok(s)
        }

        fn write_info(&mut self) -> windows::core::Result<()> {
            let handle = unsafe { self.tex.cast::<IDXGIResource>()?.GetSharedHandle()? };
            let (w, h) = (self.width, self.height);
            let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
            self.info.with(|b| {
                b.fill(0);
                b[0..4].copy_from_slice(&(handle.0 as usize as u32).to_le_bytes());
                b[4..8].copy_from_slice(&w.to_le_bytes());
                b[8..12].copy_from_slice(&h.to_le_bytes());
                b[12..16].copy_from_slice(&(DXGI_FORMAT_B8G8R8A8_UNORM.0 as u32).to_le_bytes());
                let n = exe.len().min(255);
                b[20..20 + n].copy_from_slice(&exe.as_bytes()[..n]);
            });
            Ok(())
        }

        /// Janela mudou de tamanho: textura nova (handle novo) e o mapa do sender atualizado.
        pub fn resize(&mut self, dev: &ID3D11Device, w: u32, h: u32) -> windows::core::Result<()> {
            let bind = (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32;
            self.tex = texture(dev, w, h, D3D11_USAGE_DEFAULT, bind, 0, D3D11_RESOURCE_MISC_SHARED.0 as u32)?;
            (self.width, self.height) = (w, h);
            self.write_info()
        }

        /// Copia `src` (mesmo tamanho) para a textura compartilhada dentro do mutex de acesso e
        /// conta o quadro. Sem o lock em 67 ms (receptor lendo), o quadro é descartado, como no SDK.
        pub fn send(&self, ctx: &ID3D11DeviceContext, src: &ID3D11Texture2D) -> bool {
            unsafe {
                if WaitForSingleObject(self.access.0, LOCK_MS) != WAIT_OBJECT_0 {
                    return false;
                }
                ctx.CopyResource(&self.tex, src);
                ctx.Flush();
                if WaitForSingleObject(self.count.0, 0) == WAIT_OBJECT_0 {
                    let _ = ReleaseSemaphore(self.count.0, 2, None);
                }
                let _ = ReleaseMutex(self.access.0);
                true
            }
        }

        pub fn texture(&self) -> &ID3D11Texture2D {
            &self.tex
        }
    }

    impl Drop for Sender {
        fn drop(&mut self) {
            let me = self.name.clone();
            let rest = self.names.with(|list| {
                let rest: Vec<String> = read_names(list).into_iter().filter(|n| *n != me).collect();
                write_names(list, &rest);
                rest
            });
            // o SDK passa o "ativo" para o primeiro que sobrou; se não sobrou ninguém, deixa como está
            if let Some(first) = rest.first() {
                if let Ok(mut active) = Map::open("ActiveSenderName", NAME_LEN) {
                    active.with(|b| {
                        if read_names(b).first() == Some(&me) {
                            write_names(b, std::slice::from_ref(first));
                        }
                    });
                }
            }
        }
    }

    /// Device D3D11 no adaptador que mostra o monitor da janela (notebook com 2 GPUs: a captura
    /// e a textura ficam na mesma GPU, sem cópia entre adaptadores).
    pub fn device_for(hwnd: HWND) -> windows::core::Result<(ID3D11Device, ID3D11DeviceContext)> {
        let mon = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let adapter: Option<IDXGIAdapter> = unsafe {
            let f: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut found = None;
            'a: for i in 0.. {
                let Ok(ad) = f.EnumAdapters1(i) else { break };
                for j in 0.. {
                    let Ok(out) = ad.EnumOutputs(j) else { break };
                    if out.GetDesc().is_ok_and(|d| d.Monitor == mon) {
                        found = Some(ad.cast()?);
                        break 'a;
                    }
                }
            }
            found
        };
        let (mut dev, mut ctx) = (None, None);
        let kind = if adapter.is_some() { D3D_DRIVER_TYPE_UNKNOWN } else { D3D_DRIVER_TYPE_HARDWARE };
        unsafe {
            D3D11CreateDevice(adapter.as_ref(), kind, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut dev), None, Some(&mut ctx))?;
        }
        Ok((dev.unwrap(), ctx.unwrap()))
    }

    fn err(what: &str, e: windows::core::Error) -> String {
        format!("{what}: {e}")
    }

    /// Laço da thread: captura → cópia → contagem, até `stop` ou a janela sumir.
    pub fn run(hwnd: isize, name: &str, stop: &AtomicBool, status: &Mutex<Status>) -> Result<(), String> {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED); // já iniciado nesta thread não é erro para nós
        }
        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
            return Err("Este Windows não tem captura de janela (Windows Graphics Capture): Spout indisponível".into());
        }
        let hwnd = HWND(hwnd as _);
        let (dev, ctx) = device_for(hwnd).map_err(|e| err("GPU", e))?;
        let item: GraphicsCaptureItem = unsafe {
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                .and_then(|i| i.CreateForWindow(hwnd))
                .map_err(|e| err("Captura da janela do telão", e))?
        };
        let winrt_dev: IDirect3DDevice = unsafe {
            CreateDirect3D11DeviceFromDXGIDevice(&dev.cast::<IDXGIDevice>().map_err(|e| err("GPU", e))?)
                .and_then(|d| d.cast())
                .map_err(|e| err("GPU", e))?
        };
        let mut size = item.Size().map_err(|e| err("Tamanho da janela", e))?;
        let fmt = DirectXPixelFormat::B8G8R8A8UIntNormalized;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt_dev, fmt, 2, size).map_err(|e| err("Captura", e))?;
        let session = pool.CreateCaptureSession(&item).map_err(|e| err("Captura", e))?;
        let _ = session.SetIsBorderRequired(false); // Windows 11; no 10 a borda amarela aparece
        let _ = session.SetIsCursorCaptureEnabled(false);
        let mut sender = Sender::new(&dev, name, size.Width as u32, size.Height as u32).map_err(|e| err("Sender Spout", e))?;
        session.StartCapture().map_err(|e| err("Captura", e))?;
        {
            let mut g = status.lock().unwrap();
            (g.name, g.width, g.height, g.last_error) = (sender.name.clone(), sender.width, sender.height, None);
        }

        let (mut frames, mut window, mut t_win) = (0u64, 0u32, Instant::now());
        let result = loop {
            if stop.load(Relaxed) {
                break Ok(());
            }
            let frame = match pool.TryGetNextFrame() {
                Ok(f) => f,
                Err(_) => {
                    // sem quadro novo (janela parada ou minimizada); janela destruída = fim
                    if !unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)).as_bool() } {
                        break Err("A janela do telão foi fechada".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(2));
                    if t_win.elapsed() >= Duration::from_secs(1) {
                        status.lock().unwrap().fps = window as f32 / t_win.elapsed().as_secs_f32();
                        (window, t_win) = (0, Instant::now());
                    }
                    continue;
                }
            };
            let Ok(content) = frame.ContentSize() else { continue };
            if content.Width != size.Width || content.Height != size.Height {
                size = content;
                if pool.Recreate(&winrt_dev, fmt, 2, size).is_err() || sender.resize(&dev, size.Width as u32, size.Height as u32).is_err() {
                    break Err("Não consegui acompanhar o novo tamanho da janela do telão".into());
                }
                let mut g = status.lock().unwrap();
                (g.width, g.height) = (sender.width, sender.height);
                continue; // este quadro ainda tem o tamanho antigo
            }
            let tex: Result<ID3D11Texture2D, _> = frame.Surface().and_then(|s| s.cast::<IDirect3DDxgiInterfaceAccess>()).and_then(|a| unsafe { a.GetInterface() });
            if let Ok(tex) = tex {
                if sender.send(&ctx, &tex) {
                    frames += 1;
                    window += 1;
                    status.lock().unwrap().frames = frames; // janela parada manda 1 quadro só: contar já
                }
            }
            let _ = frame.Close();
            if t_win.elapsed() >= Duration::from_secs(1) {
                status.lock().unwrap().fps = window as f32 / t_win.elapsed().as_secs_f32();
                (window, t_win) = (0, Instant::now());
            }
        };
        let _ = session.Close();
        let _ = pool.Close();
        status.lock().unwrap().frames = frames;
        drop(sender);
        result
    }

    #[cfg(test)]
    pub mod tests {
        use super::*;
        use windows::Win32::Foundation::{COLORREF, LPARAM, LRESULT, WPARAM};
        use windows::Win32::Graphics::Gdi::CreateSolidBrush;
        use windows::Win32::System::LibraryLoader::GetModuleHandleA;
        use windows::Win32::System::Memory::OpenFileMappingA;
        use windows::core::PCWSTR;
        use windows::Win32::System::Threading::{OpenMutexW, OpenSemaphoreW, SYNCHRONIZATION_SYNCHRONIZE, SEMAPHORE_ALL_ACCESS};

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(Some(0)).collect()
        }
        use windows::Win32::UI::WindowsAndMessaging::*;

        /// Abre um mapa como um receptor faria (handle novo; o namespace é o mesmo de outro processo).
        pub fn peek(name: &str, len: usize) -> Option<Vec<u8>> {
            unsafe {
                let n = cstr(name);
                let h = OpenFileMappingA(FILE_MAP_ALL_ACCESS.0, false, PCSTR(n.as_ptr())).ok()?;
                let v = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, len);
                let out = (!v.Value.is_null()).then(|| std::slice::from_raw_parts(v.Value as *const u8, len).to_vec());
                let _ = UnmapViewOfFile(v);
                let _ = CloseHandle(h);
                out
            }
        }

        pub fn exists_mutex(name: &str) -> bool {
            let n = wide(name);
            unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, PCWSTR(n.as_ptr())).map(|h| CloseHandle(h)).is_ok() }
        }

        /// Receptor: acha o sender pelo mapa, abre a textura pelo handle e lê o pixel (x, y) (BGRA).
        pub fn receive_pixel(name: &str, x: u32, y: u32) -> Option<([u8; 4], u32, u32)> {
            let info = peek(name, INFO_SIZE)?;
            let u = |i: usize| u32::from_le_bytes(info[i..i + 4].try_into().unwrap());
            let (h, w, hh, fmt) = (u(0), u(4), u(8), u(12));
            assert_eq!(fmt, DXGI_FORMAT_B8G8R8A8_UNORM.0 as u32);
            let (dev, ctx) = device_for(HWND::default()).ok()?;
            unsafe {
                let mut t: Option<ID3D11Texture2D> = None;
                dev.OpenSharedResource(HANDLE(h as usize as _), &mut t).ok()?;
                let staging = texture(&dev, w, hh, D3D11_USAGE_STAGING, 0, D3D11_CPU_ACCESS_READ.0 as u32, 0).ok()?;
                ctx.CopyResource(&staging, &t?);
                let mut m = D3D11_MAPPED_SUBRESOURCE::default();
                ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut m)).ok()?;
                let p = (m.pData as *const u8).add((y * m.RowPitch + x * 4) as usize);
                let px = [*p, *p.add(1), *p.add(2), *p.add(3)];
                ctx.Unmap(&staging, 0);
                Some((px, w, hh))
            }
        }

        /// Contagem de quadros como o receptor do SDK lê (SpoutFrameCount::GetNewFrame).
        pub fn receiver_frame_count(name: &str) -> Option<i32> {
            let n = wide(&format!("{name}_Count_Semaphore"));
            unsafe {
                let h = OpenSemaphoreW(SEMAPHORE_ALL_ACCESS, false, PCWSTR(n.as_ptr())).ok()?;
                WaitForSingleObject(h, 0);
                let mut prev = 0i32;
                let _ = ReleaseSemaphore(h, 1, Some(&mut prev));
                let _ = CloseHandle(h);
                Some(prev)
            }
        }

        unsafe extern "system" fn wndproc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
            DefWindowProcA(h, m, w, l)
        }

        /// Janela Win32 simples pintada de uma cor sólida (para a captura de verdade no teste).
        pub struct TestWindow(pub HWND);
        impl TestWindow {
            pub fn new(rgb: (u8, u8, u8)) -> Self {
                unsafe {
                    let inst = GetModuleHandleA(None).unwrap();
                    let class = PCSTR(c"DoubleKSpoutTeste".as_ptr() as _);
                    let wc = WNDCLASSA {
                        lpfnWndProc: Some(wndproc),
                        hInstance: inst.into(),
                        lpszClassName: class,
                        hbrBackground: CreateSolidBrush(COLORREF(rgb.0 as u32 | (rgb.1 as u32) << 8 | (rgb.2 as u32) << 16)),
                        ..Default::default()
                    };
                    RegisterClassA(&wc);
                    let h = CreateWindowExA(WINDOW_EX_STYLE(0), class, PCSTR(c"DoubleK Spout teste".as_ptr() as _), WS_POPUP | WS_VISIBLE, 100, 100, 320, 200, None, None, Some(inst.into()), None).unwrap();
                    let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                    Self(h)
                }
            }

            /// Bombeia as mensagens por `ms` (a janela precisa delas para pintar).
            pub fn pump(&self, ms: u64) {
                let t = Instant::now();
                unsafe {
                    let mut msg = MSG::default();
                    while t.elapsed() < Duration::from_millis(ms) {
                        while PeekMessageA(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageA(&msg);
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }
            }
        }
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }

        /// Registro: o sender aparece na lista e no mapa dele; o receptor (handle novo, como outro
        /// processo) lê o pixel que foi enviado e a contagem de quadros; ao soltar, sai da lista e
        /// os objetos nomeados somem.
        #[test]
        fn sender_registra_envia_e_libera() {
            let name = format!("DoubleK teste {}", std::process::id());
            let (dev, ctx) = device_for(HWND::default()).unwrap();
            let s = Sender::new(&dev, &name, 64, 32).unwrap();
            let names = read_names(&peek("SpoutSenderNames", MAX_SENDERS * NAME_LEN).unwrap());
            assert!(names.contains(&name), "{names:?}");
            assert_eq!(read_names(&peek("ActiveSenderName", NAME_LEN).unwrap()).first(), Some(&name));
            // quadro: textura sólida (B, G, R, A) = (10, 200, 30, 255)
            let src = {
                let px: Vec<u8> = [10u8, 200, 30, 255].repeat(64 * 32);
                let desc = D3D11_TEXTURE2D_DESC {
                    Width: 64,
                    Height: 32,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_DEFAULT,
                    BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
                    CPUAccessFlags: 0,
                    MiscFlags: 0,
                };
                let data = D3D11_SUBRESOURCE_DATA { pSysMem: px.as_ptr() as _, SysMemPitch: 64 * 4, SysMemSlicePitch: 0 };
                let mut t = None;
                unsafe { dev.CreateTexture2D(&desc, Some(&data), Some(&mut t)).unwrap() };
                t.unwrap()
            };
            for _ in 0..3 {
                assert!(s.send(&ctx, &src));
            }
            let (px, w, h) = receive_pixel(&name, 40, 20).unwrap();
            assert_eq!((px, w, h), ([10, 200, 30, 255], 64, 32));
            assert_eq!(receiver_frame_count(&name), Some(3));
            assert!(exists_mutex(&format!("{name}_SpoutAccessMutex")));
            drop(s);
            let names = read_names(&peek("SpoutSenderNames", MAX_SENDERS * NAME_LEN).unwrap_or_default());
            assert!(!names.contains(&name), "ainda na lista: {names:?}");
            assert!(peek(&name, INFO_SIZE).is_none(), "o mapa do sender ficou aberto");
            assert!(!exists_mutex(&format!("{name}_SpoutAccessMutex")), "o mutex de acesso ficou aberto");
        }

        /// Custo por quadro a 1920×1080 (para docs/quality/SPOUT.md): tempo de CPU do `send`
        /// (mutex + CopyResource + Flush + contador) e até a GPU terminar a cópia.
        #[test]
        #[ignore = "benchmark: cargo test --release bench_send -- --ignored --nocapture"]
        fn bench_send_1080p() {
            let (dev, ctx) = device_for(HWND::default()).unwrap();
            let s = Sender::new(&dev, &format!("DoubleK bench {}", std::process::id()), 1920, 1080).unwrap();
            let src = texture(&dev, 1920, 1080, D3D11_USAGE_DEFAULT, D3D11_BIND_SHADER_RESOURCE.0 as u32, 0, 0).unwrap();
            let mut q = None;
            unsafe { dev.CreateQuery(&D3D11_QUERY_DESC { Query: D3D11_QUERY_EVENT, MiscFlags: 0 }, Some(&mut q)).unwrap() };
            let q = q.unwrap();
            let (mut cpu, mut gpu) = (vec![], vec![]);
            for i in 0..660 {
                let t0 = Instant::now();
                assert!(s.send(&ctx, &src));
                let t1 = Instant::now();
                unsafe {
                    ctx.End(&q);
                    ctx.Flush();
                    while ctx.GetData(&q, None, 0, 0) != Ok(()) {
                        std::hint::spin_loop();
                    }
                }
                if i >= 60 {
                    cpu.push((t1 - t0).as_secs_f64() * 1e3);
                    gpu.push(t0.elapsed().as_secs_f64() * 1e3);
                }
            }
            let p = |mut v: Vec<f64>, q: f64| {
                v.sort_by(f64::total_cmp);
                v[((v.len() - 1) as f64 * q) as usize]
            };
            println!("BENCH send 1920×1080 ({} quadros): CPU mediana {:.3} ms, p95 {:.3} ms · até a GPU terminar: mediana {:.3} ms, p95 {:.3} ms",
                cpu.len(), p(cpu.clone(), 0.5), p(cpu, 0.95), p(gpu.clone(), 0.5), p(gpu, 0.95));
        }

        /// Religar (telão mudou de monitor): volta com o mesmo nome, uma vez só na lista, e captura.
        #[test]
        #[ignore = "abre uma janela e captura pela tela (WGC); rode com --ignored numa sessão com desktop"]
        fn religar_mantem_o_nome() {
            let win = TestWindow::new((200, 30, 30));
            win.pump(300);
            let name = format!("DoubleK religa {}", std::process::id());
            let mut sp = Spout::start(win.0 .0 as isize, name.clone());
            let wait = |sp: &Spout| {
                let t = Instant::now();
                while sp.status().frames == 0 && sp.status().running && t.elapsed() < Duration::from_secs(5) {
                    win.pump(50);
                }
            };
            wait(&sp);
            assert!(sp.status().frames > 0, "{:?}", sp.status());
            unsafe {
                let _ = SetWindowPos(win.0, None, 400, 300, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
            sp.restart();
            wait(&sp);
            let st = sp.status();
            assert!(st.running && st.frames > 0 && st.name == name, "{st:?}");
            let list = read_names(&peek("SpoutSenderNames", MAX_SENDERS * NAME_LEN).unwrap());
            assert_eq!(list.iter().filter(|n| n.starts_with(&name)).count(), 1, "{list:?}");
            let (px, _, _) = receive_pixel(&name, 160, 100).unwrap();
            assert!(px[2] > 180 && px[1] < 60, "pixel {px:?} não é o vermelho da janela");
            sp.stop();
        }

        /// Captura de verdade: janela de teste verde → Spout → receptor lê verde; stop libera tudo.
        /// Abre uma janela na tela e precisa de desktop (WGC): rode com `cargo test -- --ignored`.
        #[test]
        #[ignore = "abre uma janela e captura pela tela (WGC); rode com --ignored numa sessão com desktop"]
        fn captura_janela_e_libera() {
            let win = TestWindow::new((20, 220, 40));
            win.pump(300);
            let name = format!("DoubleK captura {}", std::process::id());
            let mut sp = Spout::start(win.0 .0 as isize, name.clone());
            let t = Instant::now();
            while sp.status().frames == 0 && sp.status().running && t.elapsed() < Duration::from_secs(5) {
                win.pump(50);
            }
            let st = sp.status();
            assert!(st.running && st.last_error.is_none(), "{st:?}");
            assert!(st.frames > 0, "nenhum quadro capturado: {st:?}");
            let (px, w, h) = receive_pixel(&name, 160, 100).expect("receptor não achou o sender");
            println!("captura: {st:?}; pixel do meio {px:?} ({w}×{h})");
            assert_eq!((w, h), (320, 200));
            assert!(px[1] > 200 && px[0] < 60 && px[2] < 60, "pixel {px:?} não é o verde da janela");
            sp.stop();
            assert!(!sp.status().running);
            assert!(peek(&name, INFO_SIZE).is_none(), "o mapa do sender ficou aberto");
            assert!(!exists_mutex(&format!("{name}_SpoutAccessMutex")));
            assert!(!read_names(&peek("SpoutSenderNames", MAX_SENDERS * NAME_LEN).unwrap_or_default()).contains(&name));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_do_sender() {
        assert_eq!(check_name("  DoubleK Visuals ").unwrap(), "DoubleK Visuals");
        assert!(check_name("").is_err());
        assert!(check_name("a\u{7}b").is_err());
        assert!(check_name(&"x".repeat(201)).is_err());
    }
}
