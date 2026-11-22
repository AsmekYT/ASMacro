use crate::cli::{Args, Scope};
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONQUESTION, MB_ICONWARNING, MB_OK,
    MB_YESNO, MB_YESNOCANCEL,
};

fn lang() -> &'static str {
    use windows::Win32::Globalization::GetUserDefaultUILanguage;
    match unsafe { GetUserDefaultUILanguage() } & 0x3ff {
        0x15 => "pl",
        _ => "en",
    }
}

fn t(en: &str, pl: &str) -> String {
    match lang() {
        "pl" => pl.to_string(),
        _ => en.to_string(),
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn message_box(
    text: &str,
    title: &str,
    flags: windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE,
) -> i32 {
    let text = wide(text);
    let title = wide(title);
    unsafe {
        MessageBoxW(
            Some(HWND::default()),
            PCWSTR(text.as_ptr()),
            PCWSTR(title.as_ptr()),
            flags,
        )
        .0
    }
}

const TITLE: &str = "ASMacro Setup";

pub fn offer_webview2_bootstrap() -> bool {
    let question = t(
        "ASMacro needs the Microsoft Edge WebView2 component to show its setup screen. Download it now (about 2 MB)?",
        "ASMacro potrzebuje komponentu Microsoft Edge WebView2, aby wyświetlić instalator. Pobrać go teraz (ok. 2 MB)?",
    );
    if message_box(&question, TITLE, MB_YESNO | MB_ICONQUESTION) != IDYES.0 {
        return false;
    }

    let mut last_step = String::new();
    let result = crate::engine::webview2::bootstrap(&mut |_pct, step| {
        last_step = step.to_string();
    });

    match result {
        Ok(()) => true,
        Err(e) => {
            crate::log::line(&format!("webview2 bootstrap failed: {e}"));
            let failure = t(
                "Couldn't install the WebView2 component. Setup will continue with a simplified installer.",
                "Nie udało się zainstalować komponentu WebView2. Instalacja będzie kontynuowana w uproszczonym trybie.",
            );
            let _ = message_box(&failure, TITLE, MB_OK | MB_ICONWARNING);
            let _ = last_step;
            false
        }
    }
}

pub fn run(mut args: Args) -> i32 {
    let existing = crate::engine::detect::find_existing();

    if args.dir.is_none()
        && args.scope.is_none()
        && crate::engine::install::already_installed(existing.as_ref(), crate::VERSION)
    {
        let msg = t(
            "This version of ASMacro is already installed and its files are intact.",
            "Ta wersja ASMacro jest już zainstalowana, a jej pliki są nienaruszone.",
        );
        let _ = message_box(&msg, TITLE, MB_OK | MB_ICONINFORMATION);
        return 0;
    }

    if args.scope.is_none() && existing.is_none() {
        let question = t(
            "Install ASMacro for you only (recommended, no administrator rights needed)?\n\nChoose \"No\" to install for all users of this computer (requires administrator rights).",
            "Zainstalować ASMacro tylko dla Ciebie (zalecane, bez uprawnień administratora)?\n\nWybierz „Nie”, aby zainstalować dla wszystkich użytkowników tego komputera (wymaga uprawnień administratora).",
        );
        match message_box(&question, TITLE, MB_YESNOCANCEL | MB_ICONQUESTION) {
            x if x == windows::Win32::UI::WindowsAndMessaging::IDYES.0 => {
                args.scope = Some(Scope::User)
            }
            x if x == windows::Win32::UI::WindowsAndMessaging::IDNO.0 => {
                args.scope = Some(Scope::Machine)
            }
            _ => return 4,
        }
    }

    let installing = t(
        "Installing ASMacro. This will only take a moment.",
        "Instalowanie ASMacro. To potrwa chwilę.",
    );
    crate::log::line(&installing);

    let code = crate::do_install(&args);

    let (msg, flags) = if code == 0 {
        (
            t(
                "ASMacro was installed successfully.",
                "ASMacro został pomyślnie zainstalowany.",
            ),
            MB_OK | MB_ICONINFORMATION,
        )
    } else {
        (
            t(
                "Setup failed. Check the log file for details.",
                "Instalacja nie powiodła się. Szczegóły w pliku dziennika.",
            ),
            MB_OK | MB_ICONERROR,
        )
    };
    let _ = message_box(&msg, TITLE, flags);

    code
}

pub fn run_uninstall(args: Args) -> i32 {
    let question = t(
        "Uninstall ASMacro from this computer?\n\nChoose \"No\" to also delete your macros and settings. Choose \"Cancel\" to abort.",
        "Odinstalować ASMacro z tego komputera?\n\nWybierz „Nie”, aby dodatkowo usunąć swoje makra i ustawienia. Wybierz „Anuluj”, aby przerwać.",
    );
    let mut args = args;
    match message_box(&question, TITLE, MB_YESNOCANCEL | MB_ICONWARNING) {
        x if x == windows::Win32::UI::WindowsAndMessaging::IDYES.0 => args.purge = false,
        x if x == windows::Win32::UI::WindowsAndMessaging::IDNO.0 => args.purge = true,
        _ => return 4,
    }
    args.uninstall = true;

    let code = crate::do_uninstall(&args);

    let (msg, flags) = if code == 0 {
        (
            t(
                "ASMacro has been uninstalled.",
                "ASMacro zostało odinstalowane.",
            ),
            MB_OK | MB_ICONINFORMATION,
        )
    } else {
        (
            t(
                "Uninstall failed. Check the log file for details.",
                "Deinstalacja nie powiodła się. Szczegóły w pliku dziennika.",
            ),
            MB_OK | MB_ICONERROR,
        )
    };
    let _ = message_box(&msg, TITLE, flags);
    code
}
