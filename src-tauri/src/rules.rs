use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tracks the last phrase returned per trigger, so we don't repeat the same
/// line twice in a row for the same situation.
pub struct RulesState(pub Mutex<HashMap<String, String>>);

const STARTUP_PHRASES: &[&str] = &[
    "working again huh how boring",
    "computer's on so much for peace and quiet",
    "hey i hope you're not gonna keep me busy all day",
    "same screen again aren't you bored yet",
    "we're up and i'm already tired",
    "oh it's you what do you need make it quick",
    "couldn't i just nap instead",
    "productivity theater again today",
    "you work i'll supervise very fair arrangement",
    "i'm awake unfortunately",
    "same room again great",
    "your computer booted slow just like me",
    "saw you again guess my break's over",
    "work's starting don't blame me for how this goes",
    "another day another round of this",
    "alright let's see how long you last today",
    "hey you're back who said i needed you here",
    "here we go back to the screen",
    "what are we doing today boredom or burnout",
    "you're back huh guess peace and quiet is done for",
    "time to work someone woke me up for this apparently",
    "same desk same screen thrilling life we lead",
    "today you're making me work too aren't you",
    "computer's up guess i have to be present too",
    "here we go again i can already feel it",
    "showed up i wasn't ready but sure let's go",
    "your work started i'll just watch and silently judge",
    "how many hours today let's find out together",
    "you're keeping me busy again i knew this was coming",
    "another round of this huh",
    "hi your mood doesn't concern me but i asked anyway",
    "you're here so quiet time is officially over",
    "let's go i guess pretending to work starts now",
    "oh good you're back thrilling news",
    "booted up huh here we go again",
    "i was sleeping so well too",
    "another day glued to this screen for both of us",
    "well well look who decided to show up",
];

const LONG_FOCUS_PHRASES: &[&str] = &[
    "two hours in i'm almost impressed",
    "wow you're still at it didn't expect that",
    "this kind of focus is honestly surprising me",
    "turns out you're a serious person who knew",
    "aren't you tired i'm tired just watching you",
    "this much focus is a little unsettling honestly",
    "good work but seriously take a break my fur says so",
    "you've impressed me that doesn't happen often",
    "keep this up and i might start respecting you be careful",
    "you've been sitting a while doesn't your back hurt mine does from watching",
    "still here huh that's impressive",
    "you haven't stopped you're making me look bad",
    "this much focus isn't easy i know but take a break anyway",
    "setting records today huh",
    "you don't seem tired or you're hiding it really well",
    "you outlasted me congratulations i guess",
    "this seriousness doesn't suit you kidding keep going",
    "still working aren't you tired yet",
    "i'd have given up by now you're built different",
    "i'm slowly gaining respect for you don't get used to it",
    "something's different about you today it's working",
    "this much sitting can't be good for you but that's on you",
    "patience isn't my strong suit yours is apparently",
    "still going huh must be serious today",
    "you keep impressing me and i don't like it",
    "your eyes are glued to the screen careful now",
    "keep this pace up and tomorrow you'll surprise even yourself",
    "i couldn't focus like this you've earned some respect",
    "the floor's still there right you've been sitting a while",
    "you don't know how to get tired do you",
    "quite a stretch you've pulled off not gonna lie",
    "i have to work too now thanks to you no shame in that",
    "that's a lot of focus i'll admit it's impressive",
    "you're really locked in today huh who are you",
];

const MIDNIGHT_PHRASES: &[&str] = &[
    "i'm going to sleep you should too you idiot",
    "it's the middle of the night sane people are asleep and you're not",
    "still up huh you'll regret this tomorrow",
    "coding this late is a terrible habit i'm guilty of it too honestly",
    "your eyes must be tired mine are tired just from watching you",
    "right now it's just the two of us awake and that's not a great sign",
    "your bed is calling can you not hear it",
    "it's midnight coffee won't save you now trust me",
    "still not asleep how are you gonna get up tomorrow",
    "staying up like this is wearing you down you know that right",
    "i'm tired too are you leaving anytime soon",
    "at this hour only fools and i are awake",
    "go lie down tomorrow will still be there either way",
    "your eyes are closing i can tell i'm watching you",
    "you're turning night into day again",
    "do you even know what time it is",
    "is sleep a stranger to you these days",
    "i've been patient long enough it's time to sleep",
    "tomorrow's gonna be worse than today just so you know",
    "still not settling down when do you stop",
    "at this hour everyone's asleep except idiots and me apparently",
    "woke me up and it's dark outside for a reason",
    "working this late isn't a good idea but you do you i guess",
    "the only light is coming from your screen that's not a good sign",
    "are you planning to stay up till sunrise",
    "your eyes look tired i can see it from here",
    "it's been a long night hasn't it",
    "this can wait till morning you know",
    "i'm calling it a night are you coming or not",
    "this hour belongs to dreams not deadlines",
    "midnight snacks won't fix your sleep schedule",
    "you're the only one still glowing in the dark besides me",
    "tomorrow-you is gonna be furious at tonight-you",
    "the world's asleep and you're still here typing",
    "i blinked twice that's my way of saying go to bed",
    "burning the midnight oil again i see",
    "sleep is free you know unlike whatever this is",
];

const COMMIT_PHRASES: &[&str] = &[
    "whoa the code actually worked",
    "did you push that congratulations i guess",
    "so you actually made something not bad",
    "commit's in great now can we get back to napping",
    "code saved and you're still not tired huh",
    "hopefully there's less chaos in this one",
    "another line added to your git history proud of you technically",
    "did it work or was that productivity theater",
    "another commit so something actually got done",
    "nice you made something again",
    "code saved are you relieved now",
    "is today's work actually done or is there more",
    "you committed that means you trust yourself apparently",
    "does the thing you built even work or will you cry later",
    "did you push brave of you",
    "another win or just wishful thinking",
    "your commit history got richer congrats",
    "so you were useful today at least once",
    "saw the commit i believe in you for now",
    "you made it happen can you rest now",
    "your code history grows another day another line",
    "did you break something or fix something we'll see",
    "this commit looks confident or maybe you're just scared and pushed anyway",
    "nice bit of progress today",
    "code's out there now no turning back",
    "committed it huh let's hope it holds",
    "another change made i hope you tested it",
    "progress i'll allow myself to be a little impressed",
    "you did something today doesn't happen every day",
    "saved your work good now go touch grass",
    "that's one more commit closer to done whatever done means",
    "small steps i guess this counts as one",
    "you actually finished something remarkable",
    "that commit message better make sense",
    "look at you being productive who are you",
];

const LONG_IDLE_PHRASES: &[&str] = &[
    "you left me great",
    "where'd you go aren't you coming back",
    "i'm just sitting here alone forgotten",
    "you've been gone a while not that i miss you or anything",
    "still not back i already fell asleep waiting",
    "sorry i can't say i missed you out loud",
    "where are you wandering off to you still have things to do",
    "did you forget about me seems like it",
    "the screen went dark and so did you",
    "you really just walked off huh at least say bye next time",
    "being alone again i'm getting used to it apparently",
    "are you coming back or is this it",
    "waiting around is exhausting you know",
    "i'm just frozen here while you're out there living your life",
    "i didn't notice you were gone i'm lying though",
    "you've been gone long enough i started dozing off",
    "you left without a word again typical",
    "i'm alone again story of my life apparently",
    "hey are you still out there",
    "this waiting thing isn't really my style",
    "quiet without you here not that it's a big deal",
    "did you get distracted by something better than me",
    "you vanished i see how it is",
    "i'll just wait here like i have a choice",
    "still gone huh guess it's just me and the silence",
    "you could've at least said you'd be a while",
    "the room feels emptier when you're not around not that i'd admit it twice",
    "taking your time out there aren't you",
];

const CLICK_PHRASES: &[&str] = &[
    "what leave me alone",
    "don't poke me",
    "yeah what do you want",
    "quit clicking aren't you bored of that yet",
    "be gentle please",
    "clicking again enjoying yourself",
    "don't touch me",
    "fine fine i heard you",
    "what now",
    "stop poking i'm gonna get dizzy",
    "seriously what's the deal",
    "do you have nothing better to do than click me",
    "hey watch it",
    "yes i'm listening",
    "don't treat me like a toy",
    "hands off",
    "how many more times are you gonna do that",
    "that tickles stop it",
    "ow be careful",
    "i felt that you know",
    "rude",
    "again really",
    "i'm not a button",
    "okay okay what do you want from me",
    "quit it i'm trying to nap",
    "you like bothering me don't you",
    "click harder and see what happens",
    "i'm judging you right now",
    "that's enough of that",
    "keep it up and i'm hiding under the desk",
];

const POMODORO_WORK_DONE_PHRASES: &[&str] = &[
    "time's up go stretch or something",
    "25 minutes done now leave the screen for a bit",
    "break time don't argue with me",
    "you survived the work block barely",
    "go get water i'll watch the screen for you",
    "session's over now shoo",
    "that's enough staring for now",
    "break time even i rest more than that",
    "you can stop pretending to focus now",
    "timer's done go be a person for five minutes",
    "alright that's a wrap for now",
    "five minutes of freedom starts now don't waste it on the screen",
    "you did the work thing now do the rest thing",
    "off you go rest is mandatory not optional",
    "the clock says break i agree with the clock",
];

const POMODORO_BREAK_DONE_PHRASES: &[&str] = &[
    "break's over yes i timed it",
    "back to work unfortunately for both of us",
    "rest time's up don't look at me like that",
    "five minutes gone already get back to it",
    "okay break's done now go pretend to be productive",
    "the fun's over it's work time again",
    "you rested now go suffer some more",
    "clock says work again blame the clock not me",
    "back to the grind i'll be here judging",
    "break ended right on schedule sadly",
    "time to work again i already miss the quiet",
    "get back to it the timer doesn't care about your feelings",
    "rest's done reality's calling",
    "back at it champ or whatever you are",
    "the break's gone same as always",
];

fn phrases_for(trigger: &str) -> &'static [&'static str] {
    match trigger {
        "startup" => STARTUP_PHRASES,
        "long_focus" => LONG_FOCUS_PHRASES,
        "midnight" => MIDNIGHT_PHRASES,
        "commit" => COMMIT_PHRASES,
        "long_idle" => LONG_IDLE_PHRASES,
        "click" => CLICK_PHRASES,
        "pomodoro_work_done" => POMODORO_WORK_DONE_PHRASES,
        "pomodoro_break_done" => POMODORO_BREAK_DONE_PHRASES,
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
