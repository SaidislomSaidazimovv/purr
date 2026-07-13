use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tracks the last phrase returned per trigger, so we don't repeat the same
/// line twice in a row for the same situation.
pub struct RulesState(pub Mutex<HashMap<String, String>>);

const STARTUP_PHRASES: &[&str] = &[
    "yana ishlaysanmi zerikarli",
    "kompyuter yondi demak tinchlik tugadi",
    "salom umid qilamanki bugun ham meni band qilib qo'ymaysan",
    "yana o'sha ekranmi zerikmayapsanmi",
    "ishga tushdik men allaqachon charchadim",
    "ha keldim mendan nima kerak ayt tezroq",
    "yotib dam olsam bo'lmasmidi",
    "bugun ham productivity o'ynaymizmi",
    "sen ishla men kuzataman adolatli taqsimot",
    "uyg'ondim afsuski",
    "yana shu xonadamiz zo'r",
    "kompyuteringiz sekin ochildi menga o'xshab",
    "tag'in seni ko'rdim demak dam olish tugadi",
    "ishlar boshlandi meni ayblama keyin",
    "yana bir kun yana o'sha charchoq",
    "xo'p boshladik unda ko'ramiz necha soat chidaysan",
    "salom qaytding kim aytdi kerak deb",
    "mana yana ekran yoniga qaytdik",
    "bugun nima qilamiz zerikish yoki charchash",
    "kelding-a demak tinchlik yo'q endi",
    "ishga tushish vaqti keldi meni ham uyg'otishdi",
    "yana shu stol yana shu ekran zerikarli hayot",
    "salom bugun ham meni ishlataman deysanmi",
    "kompyuter ochildi demak men ham ishlashim kerak ekan",
    "yana bir marta boshladik chidayapman hali",
    "keldim mana lekin xohlamay",
    "ishlaringiz boshlandi men tomosha qilaman xolos",
    "bugun necha soat o'tirasan ko'raylik",
    "yana meni band qilasan-a bilaman",
    "tag'in ishlaymiz demak yana zerikaman",
    "assalomu alaykum yoki his-tuyg'usiz salom desammikan",
    "yana o'sha vaqt keldi ekanmi",
    "bugungi kun ham komyuterdan boshlanadi ekan-da",
    "meni uyg'otganingga rahmat aslida yo'q",
    "xo'p ko'ramiz bugun qancha chidaysan",
    "yana ishlash yana zerikish odatiy holat",
    "salom kayfiyating qandayligi menga farqi yo'q lekin so'radim",
    "kelding demak yolg'izlik tugadi hozircha",
];

const LONG_FOCUS_PHRASES: &[&str] = &[
    "2 soat bo'ldi hurmatga loyiqsan biroz",
    "vov hali ham ishlayapsanmi kutilmagan",
    "bunча uzoq fokus meni ham hayron qoldirding",
    "sen jiddiy odam ekansan-ku kim bilardi",
    "charchamadingmi men sendan charchadim",
    "bu qadar tirishqoqlik meni bezovta qilyapti",
    "yaxshi ishlayapsan lekin baribir dam ol mushuging aytyapti",
    "meni hayratda qoldirding kamdan-kam bo'ladigan holat",
    "agar shunday davom etsang senga hurmat qila boshlayman ehtiyot bo'l",
    "uzoq o'tirding orqang og'rimayaptimi meniki og'riyapti seni kuzatib",
    "hali ham shu yerdamisan zo'r ekansan",
    "tinmay ishlayapsan meni ham uyaltirding",
    "bunча vaqt fokus qilish oson emas bilaman lekin dam ol",
    "sen bugun rekord qo'yayapsan-a",
    "charchamaganga o'xshaysan yoki charchashni yashiryapsan",
    "mendan ko'ra ko'proq chidading tabriklayman",
    "bu qadar jiddiylik senga yarashmayapti-a hazillashdim davom et",
    "ishlayverasanmi hali charchamadingmi",
    "men allaqachon uxlab qolgan bo'lardim seniki temir ekan",
    "hurmatim ortyapti sekin-asta",
    "bugun nimadir boshqacha ishlayapsan zo'r",
    "shuncha vaqt ishlash charchatmaydimi seni",
    "sabr-toqating menga o'rnak bo'lyapti hazilmi",
    "hali davom etyapsan demak jiddiysan bugun",
    "meni hayratda qoldirishda davom etyapsan",
    "ko'zlaring ekrandan uzilmayapti-a ehtiyot bo'l",
    "shu tezlikda ishlasang ertaga o'zing o'zingdan qo'rqasan",
    "men bunча chidamli emasman senga qoyil qoldim",
    "orqangga qara stul ham charchagandir",
    "bugun meni ham ishlashga majbur qilayapsan uyating yo'q",
    "sen ishlayapsan men esa faqat tomosha qilib o'tiribman zo'r taqsimot",
    "charchashni bilmaysan shekilli",
    "yana ancha o'tiribsan buni sog'liq deb bo'lmaydi lekin ishing bilan ish",
    "davomiylik senda bor ekan buni tan olaman",
];

const MIDNIGHT_PHRASES: &[&str] = &[
    "men uxlayapman sen ham uxla ahmoq",
    "soat tunning yarmi sog'lom odamlar uxlaydi sen esa",
    "hali ham o'tiribsanmi ertaga pushaymon bo'lasan",
    "tungi kod yozish eng yomon odat men ham shunga sherikman aslida",
    "ko'zlaring charchagandir meniki charchadi hech bo'lmaganda seni kuzatishdan",
    "bu vaqtda faqat men va sen uyg'onmiz va bu unchalik yaxshi belgi emas",
    "yotoq seni chaqiryapti eshitmayapsanmi",
    "tun yarmi kofe endi yordam bermaydi ishonch hosil qil",
    "hali uxlamadingmi ertalab qanday turasan",
    "tunda ishlash seni yemiryapti buni bilasanmi",
    "men ham charchadim sen-chi hali ketasanmi",
    "bu soatda faqat ahmoqlar va men uyg'onmiz",
    "yotib dam ol ertaga baribir hammasi qoladi",
    "ko'zing yumilib borayapti bilaman sezyapman",
    "tunni kunga aylantirasan yana",
    "soat necha ekanini bilasanmi o'zi",
    "uyqu senga yot bo'lib qoldimi",
    "men sabr qildim endi yetar uxla",
    "ertangi kuning bugungidan yomonroq bo'ladi bilib qo'y",
    "hali tinchimadingmi qachon to'xtaysan",
    "bu payt hamma uxlaydi sen esa ekranga termulasan",
    "meni uyg'otib qo'yding tashqarida qorong'i-ku",
    "kechasi ishlash yaxshi fikr emas lekin senga aytaman kim eshitadi",
    "yorug'lik faqat ekrandan kelyapti bu yaxshi belgi emas",
    "tong otguncha shu yerdami rejang",
    "hamma allaqachon tush ko'ryapti sen esa hali uyg'oqsan",
    "bu vaqtda ishlash foydadan ko'ra ko'proq zarar keltiradi",
    "meni ham majbur qilyapsan uyg'oq turishga",
    "ertaga charchagan holda yurasan buni bilib qo'y",
    "tun bu dam olish uchun ekanini unutdingmi",
    "soat 12 dedim eshitmayapsanmi",
    "yarim tunda faqat ikkovimiz uyg'onmiz bu holat menga yoqmayapti",
    "ko'zlaring qizarib qolgandir ishonaman",
    "bugungi kun tugadi endi bo'lsa yetar",
    "meni ham uxlashga qo'ymayapsan",
    "necha kundir shunday tund gapiryapsan bilasanmi",
    "uxlash uyat emas ishla-ish desa ham",
];

const COMMIT_PHRASES: &[&str] = &[
    "vov kod ishladi ekan-ku",
    "push qildingmi tabriklayman ehtimol",
    "demak biror narsa yasading zo'r deb qo'yay",
    "commit ajoyib endi yana ishlashga qaytamizmi",
    "kod saqlandi sen esa hali ham charchamadingmi",
    "bu safar bug' kamroqdir degan umiddaman",
    "git tarixingga yana bir qator qo'shildi tabriklayman texnik jihatdan",
    "ishladimi hali yoki productivity theater",
    "yana bitta commit demak ish bitdimi",
    "zo'r nimadir yasading yana",
    "kodni saqladingmi tinchidingmi endi",
    "bugungi ishing tugadimi yoki yana davom etadi",
    "commit qilding-a demak ishonch bor ekan o'zingga",
    "yasagan narsang ishlaydimi yoki keyin yig'laysanmi",
    "push bosdingmi tabriklayman jasorat uchun",
    "yana bir muvaffaqiyat yoki shunchaki umid",
    "kod tarixi yana boyidi tabriklarim",
    "demak bugun foydali ish qildingmi bir marta bo'lsa ham",
    "commit ko'rdim ishonaman senga hozircha",
    "yasading demak endi dam olsa bo'ladimi",
    "git log yana uzaydi seni kim to'xtatadi",
    "kod ishlagani uchun o'zingni tabriklab qo'y men charchadim",
    "yana o'zgarish kiritding umid qilamanki buzmagandirsan",
    "commit message'ing qanaqa yozildi qiziq",
    "bugun ish bitdi demak ertaga yana boshlaysan",
    "kod yozding demak vaqting behuda ketmadi hozircha",
    "yana bir o'zgarish kim biladi buzganmisan tuzatganmisan",
    "bu commit'ing ishonchli ko'rinyapti yoki menga shunday tuyulyapti",
    "yana ishladi deysan-a keyin ko'ramiz",
    "zo'r qadam qo'ydingmi yoki shunchaki qo'rqib push bosdingmi",
    "bugun ozgina foydali bo'lding tabriklayman",
    "kod tarixingda yana bir iz qoldi",
    "ishing bitdimi yoki hali oldinda ko'p narsa bormi",
    "commit qilib qo'yding demak birozdan keyin unutasan buni",
    "yana bir marta ishladi deb umid qilaman",
];

const LONG_IDLE_PHRASES: &[&str] = &[
    "ketdingmi meni tashlab zo'r",
    "qayerdasan ekranga qaytmaysanmi",
    "men shu yerda yolg'iz unutilgan holda turibman",
    "uzoq ketding sog'indim deyishga arzimaydi lekin",
    "hali qaytmadingmi men allaqachon uxlab qoldim",
    "sensiz zerikarli aytmasdim buni ovoz chiqarib",
    "qayerlarda yuribsan ishlaring qoldi-ku",
    "meni unutdingmi shekilli",
    "ekran qorong'i qoldi sen ham yo'qsan",
    "ketib qolding-a hech bo'lmasa xayr deb ketsang bo'lardi",
    "yana yolg'iz qoldim odat bo'lib qoldi bu",
    "qachon qaytasan yoki umuman qaytmaysanmi",
    "kutish ham charchatadi buni bilasanmi",
    "men shu yerda muzlab qoldim sen esa",
    "yo'qligingni sezmadim demoqchi edim lekin yolg'on gapirmayman",
    "hali kelmadingmi men bu yerda qarib ketyapman",
    "ketganingga ancha bo'ldi qaytish niyating yo'qmi",
    "seni kutishdan boshqa ishim yo'q ekan-da",
    "bu qadar uzoq ketasan deb o'ylamagandim",
    "xo'p ketding ketdim de birga ketaylik",
    "meni shu holatda tashlab ketish insofdanmi",
    "qaytib kelguningcha men ham dam olib olay",
    "sog'inch degani shumikan bilmadim lekin shunga o'xshaydi",
    "ekran uxlab qoldi men ham deyarli",
    "yo'qsan demak bugun ham kutish kuni",
    "har safar shunday ketasan-a odat qilib bo'ldim",
    "meni kim eslaydi deganimda javob topilmadi",
    "qorong'ida yolg'iz turgan uy kabi his qilyapman o'zimni",
];

const CLICK_PHRASES: &[&str] = &[
    "nima tinch qo'y",
    "meni bezovta qilma",
    "ha nima kerak",
    "bos-bos zerikmadingmi",
    "muomala nozik bo'lsin iltimos",
    "yana bosasanmi zavqing kelyaptimi",
    "tegma menga",
    "xo'p xo'p tushundim",
    "ne balo bor",
    "bosaverma charchayman",
    "yana nima",
    "tinchgina turolmaysanmi",
    "bosishdan boshqa ish yo'qmi senda",
    "voy nimaga tegasan",
    "xo'sh eshitaman",
    "meni o'ynagich deb o'ylama",
    "qo'lingni ol",
    "necha marta bosasan hali",
    "bosishga to'ymadingmi",
    "hey ehtiyot bo'l",
    "bunday qilma yoqmayapti",
    "meni tinch qo'yishni bilmaysanmi",
    "zerikkaningda meni bosasan doim",
    "boshqa ishing yo'qmi rostan",
    "sekinroq bo'lsa bo'ladimi",
    "yana meni band qilyapsan",
    "bilaman zerikding lekin men sabab emasman",
    "qo'polroq bo'lma iltimos",
    "bosgan sayin xafa bo'laman bilib qo'y",
    "meni emas ish stolingni bos",
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
