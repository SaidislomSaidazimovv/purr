use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tracks the last phrase returned per trigger, so we don't repeat the same
/// line twice in a row for the same situation.
pub struct RulesState(pub Mutex<HashMap<String, String>>);

const STARTUP_PHRASES: &[&str] = &[
    "Yana ishlaysanmi? Zerikarli.",
    "Kompyuter yondi. Demak, tinchlik tugadi.",
    "Salom. Umid qilamanki, bugun ham meni band qilib qo'ymaysan.",
    "Yana o'sha ekranmi? Zerikmayapsanmi?",
    "Ishga tushdik. Men allaqachon charchadim.",
    "Ha, keldim. Mendan nima kerak, ayt tezroq.",
    "Yotib dam olsam bo'lmasmidi...",
    "Bugun ham \"productivity\" o'ynaymizmi?",
    "Sen ishla, men kuzataman. Adolatli taqsimot.",
    "Uyg'ondim. Afsuski.",
    "Yana shu xonadamiz. Zo'r.",
    "Kompyuteringiz sekin ochildi. Menga o'xshab.",
];

const LONG_FOCUS_PHRASES: &[&str] = &[
    "2 soat bo'ldi. Hurmatga loyiqsan. Biroz.",
    "Vov, hali ham ishlayapsanmi? Kutilmagan.",
    "Bunча uzoq fokus — meni ham hayron qoldirding.",
    "Sen jiddiy odam ekansan-ku. Kim bilardi.",
    "Charchamadingmi? Men sendan charchadim.",
    "Bu qadar tirishqoqlik meni bezovta qilyapti.",
    "Yaxshi ishlayapsan. Lekin baribir dam ol, mushuging aytyapti.",
    "Meni hayratda qoldirding. Kamdan-kam bo'ladigan holat.",
    "Agar shunday davom etsang, men senga hurmat qila boshlayman. Ehtiyot bo'l.",
    "Uzoq o'tirding. Orqang og'rimayaptimi? Meniki og'riyapti, seni kuzatib.",
];

const MIDNIGHT_PHRASES: &[&str] = &[
    "Men uxlayapman. Sen ham uxla, ahmoq.",
    "Soat tunning yarmi. Sog'lom odamlar uxlaydi. Sen esa...",
    "Hali ham o'tiribsanmi? Ertaga pushaymon bo'lasan.",
    "Tungi kod yozish — eng yomon odat. Men ham shunga sherikman, aslida.",
    "Ko'zlaring charchagandir. Meniki charchadi, hech bo'lmaganda seni kuzatishdan.",
    "Bu vaqtda faqat men va sen uyg'onmiz. Va bu unchalik yaxshi belgi emas.",
    "Yotoq seni chaqiryapti. Eshitmayapsanmi?",
    "Tun yarmi. Kofe endi yordam bermaydi, ishonch hosil qil.",
];

const COMMIT_PHRASES: &[&str] = &[
    "Vov. Kod ishladi ekan-ku.",
    "Push qildingmi? Tabriklayman, ehtimol.",
    "Demak, birror narsa yasading. Zo'r, deb qo'yay.",
    "Commit. Ajoyib. Endi yana ishlashga qaytamizmi?",
    "Kod saqlandi. Sen esa hali ham charchamadingmi?",
    "Bu safar bug' kamroqdir, degan umiddaman.",
    "Git tarixingga yana bir qator qo'shildi. Tabriklayman, texnik jihatdan.",
    "Ishladimi hali? Yoki productivity theater?",
];

const LONG_IDLE_PHRASES: &[&str] = &[
    "Ketdingmi? Meni tashlab? Zo'r.",
    "Qayerdasan? Ekranga qaytmaysanmi?",
    "Men shu yerda, yolg'iz, unutilgan holda turibman.",
    "Uzoq ketding. Sog'indim, deyishga arzimaydi, lekin.",
    "Hali qaytmadingmi? Men allaqachon uxlab qoldim.",
    "Sensiz zerikarli. Aytmasdim buni ovoz chiqarib.",
];

const CLICK_PHRASES: &[&str] = &[
    "Nima. Tinch qo'y.",
    "Meni bezovta qilma.",
    "Ha? Nima kerak?",
    "Bos-bos. Zerikmadingmi?",
    "Muomala nozik bo'lsin, iltimos.",
    "Yana bosasanmi? Zavqing kelyaptimi?",
    "Tegma menga.",
    "Xo'p, xo'p, tushundim.",
];

fn phrases_for(trigger: &str) -> &'static [&'static str] {
    match trigger {
        "startup" => STARTUP_PHRASES,
        "long_focus" => LONG_FOCUS_PHRASES,
        "midnight" => MIDNIGHT_PHRASES,
        "commit" => COMMIT_PHRASES,
        "long_idle" => LONG_IDLE_PHRASES,
        "click" => CLICK_PHRASES,
        _ => &[],
    }
}

/// Cheap pseudo-random index — good enough for picking a line, and avoids
/// pulling in the `rand` crate (and its compile cost) for this alone.
fn pseudo_random_index(len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos as usize) % len
}

#[tauri::command]
pub fn get_phrase(state: tauri::State<RulesState>, trigger: String) -> Option<String> {
    let pool = phrases_for(&trigger);
    if pool.is_empty() {
        return None;
    }
    if pool.len() == 1 {
        return Some(pool[0].to_string());
    }

    let mut last = state.0.lock().unwrap();
    let mut idx = pseudo_random_index(pool.len());
    if let Some(prev) = last.get(&trigger) {
        if pool[idx] == prev {
            idx = (idx + 1) % pool.len();
        }
    }

    let phrase = pool[idx].to_string();
    last.insert(trigger, phrase.clone());
    Some(phrase)
}
