# On-device speech synthesis per language

Research for [#23](https://github.com/alessandro-p/dictio/issues/23), part of the
[dictio v1 spec](https://github.com/alessandro-p/dictio/issues/19). Sources were
read in November 2026.

## Question

Can the browser's built-in speech synthesis (Web Speech API) read a term or
translation aloud in a glossary's language without the text leaving the device?
What voices exist per language on desktop and mobile browsers? Which run
locally (`localService`) and which send text to a vendor's server? How do you
pick a voice for a language, and what are the mobile quirks?

## Short answer

Yes, with conditions. Every major browser engine ships `speechSynthesis`. The
voices come from the operating system, so what is available depends on the
device, not the browser. Some browsers also add cloud voices, and those send
the text to the vendor's server:

- Desktop Google Chrome adds "Google …" voices.
- Microsoft Edge adds "Microsoft … Online" voices.

To keep text on the device, the app has to pick a voice itself, choosing one
with `localService === true`. Setting only `utterance.lang` is not enough,
because Chrome can then pick a cloud voice on its own. `localService` is also
self-reported, and two engines report `true` for every voice without checking.
It is the best signal available, not a guarantee.

## The spec

The [Web Speech API](https://webaudio.github.io/web-speech-api/) is a W3C
Community Group draft (the copy read was dated 27 October 2026). It is not a
W3C Recommendation.

- `getVoices()`: "It is user agent dependent which voices are available." If
  the list is not known yet, it "must return a SpeechSynthesisVoiceList of
  length zero". `voiceschanged` fires when the list changes.
- `SpeechSynthesisVoice.localService` "is true for voices supplied by a local
  speech synthesizer". MDN adds that remote voices "might have extra latency,
  bandwidth or cost"
  ([MDN: localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)).
  Neither the spec nor MDN describes it as a privacy guarantee.
- `default` is true for at most one voice per language, and how the default is
  chosen is user agent dependent.
- Voice selection works like this:
  - If `utterance.voice` is set to a voice from `getVoices()`, the user agent
    "must use that voice".
  - If it is null, the user agent uses its own default voice, which "should
    support the current language".
  - `utterance.lang` is a BCP 47 tag. When it is unset, it falls back to the
    document's `<html lang>`.
- The error codes include `not-allowed`, `language-unavailable`,
  `voice-unavailable`, `synthesis-unavailable` and `network`.
- The spec has no privacy section on synthesis. (Its recognition section has
  `processLocally`, but synthesis has no equivalent.)

## Browser by browser

### Chrome on desktop (Windows, macOS, Linux)

- **Two kinds of voices.** The list has the OS's own voices (native) plus the
  voices of a built-in component extension, "Google Network Speech"
  ([manifest](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/network_speech_synthesis/manifest.json)).
- **The extension's voices are remote.** The manifest marks all 19 of them
  `"remote": true`. They cover de-DE, en-US, en-GB (×2), es-ES, es-US, fr-FR,
  hi-IN, id-ID, it-IT, ja-JP, ko-KR, nl-NL, pl-PL, pt-BR, ru-RU, zh-CN, zh-HK
  and zh-TW, with names such as "Google US English" and "Google italiano".
- **They send the text to Google.** The extension builds a request to
  `https://www.google.com/speech-api/v2/synthesize?…&client=chromium` and puts
  the text in the URL with `url += '&text=' + encodeURIComponent(utterance)`
  ([tts_extension.js](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/network_speech_synthesis/tts_extension.js)).
- **`localService` is accurate here.** It is computed as
  `is_local_service = !voices[i].remote`
  ([speech_synthesis_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/content/browser/speech/speech_synthesis_impl.cc)),
  so the Google voices report `localService === false`.
- **Chrome's automatic choice ignores local versus remote**
  ([tts_controller_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/content/browser/speech/tts_controller_impl.cc),
  `GetMatchingVoice`). It scores voices on four things, in this order:
  - how well the language matches (exact region 1024, no region 512, other
    region 256, and 0 if the primary language differs);
  - support for the required events (128);
  - ChromeOS voice preferences (64, 32 or 16);
  - the browser's UI locale (8, 4 or 2).

  It never looks at the `remote` flag. Native voices come before extension
  voices in the list and win ties. But if the OS has no voice for the language
  (for example Hindi, Korean or Polish on a machine without those voices
  installed), a page that sets only `lang` gets the Google cloud voice.

- **The list changes with the connection.** `GetVoices` leaves remote voices
  out when the connection is cellular or offline, and includes them on Wi-Fi,
  Ethernet, or an unknown connection. The same machine can therefore show
  different voice lists at different times.

### Microsoft Edge on desktop

Edge adds cloud voices named "Microsoft _Name_ Online (Natural)". They are
"powered by Microsoft Cognitive Services" and "exposed to developers through the
JavaScript SpeechSynthesis API"
([Microsoft Edge blog, 2019](https://blogs.windows.com/msedgedev/2019/08/14/cloud-powered-voices-microsoft-edge-chromium/)).
Microsoft does not document what `localService` these voices report. Edge
is built on Chromium, whose model reports `false` for remote engine voices, but
that is inferred, not confirmed. The Windows (SAPI/OneCore) voices that Edge
also lists are local.

### Chrome on Android

- **Voices come from Android's default TTS engine.**
  [TtsPlatformImpl.java](https://chromium.googlesource.com/chromium/src/+/main/content/public/android/java/src/org/chromium/content/browser/TtsPlatformImpl.java)
  loops over `Locale.getAvailableLocales()` and keeps each locale for which
  `isLanguageAvailable(locale) > 0`. That gives one "voice" per locale:
  - its name is the locale's display name (for example "Italian Italy");
  - its `lang` is `locale.toString()`, so it can look like `it_IT`, with an
    underscore instead of a hyphen.
- **`localService` is always `true`.**
  [tts_android.cc](https://chromium.googlesource.com/chromium/src/+/main/content/browser/speech/tts_android.cc)
  never sets `remote`. It does not call Android's
  `Voice.isNetworkConnectionRequired()`
  ([Android Voice](https://developer.android.com/reference/android/speech/tts/Voice)).
- **The engine itself may still use the network.** Android engines can expose
  network voices, and an engine whose voice data is not yet installed may "use
  a different voice to synthesize the request"
  ([TextToSpeech.Engine, `KEY_FEATURE_NOT_INSTALLED`](https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine)).
  Chrome's `true` therefore guarantees nothing.
- **Picking a voice by name has no effect.** Chrome's `speak()` receives only
  the language (and optionally an engine ID) and calls `setLanguage`, so on
  Android the page effectively chooses a language, not a voice.
- **Android WebView** (which in-app browsers use) does not support
  `speechSynthesis`
  ([browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechSynthesis.json),
  [crbug 40417848](https://crbug.com/40417848)).

### Firefox (desktop and Android)

Firefox uses the OS speech services and adds no cloud voices of its own. Here
is what each platform backend passes as `aLocalService` ("true if service does
not require network",
[nsISynthVoiceRegistry.idl](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webspeech/synth/nsISynthVoiceRegistry.idl)):

| Platform                  | Backend                                                                                                                                                                                                                                                                                                                                | What it reports                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows                   | [SapiService.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webspeech/synth/windows/SapiService.cpp)                                                                                                                                                                                                              | always `true`                                                                                                                                                                                                                                                                                                                                                    |
| macOS                     | [OSXSpeechSynthesizerService.mm](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webspeech/synth/cocoa/OSXSpeechSynthesizerService.mm)                                                                                                                                                                                  | always `true`                                                                                                                                                                                                                                                                                                                                                    |
| Linux (speech-dispatcher) | [SpeechDispatcherService.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webspeech/synth/speechd/SpeechDispatcherService.cpp)                                                                                                                                                                                      | `true` only for the voice named `"default"`, `false` for the rest, even though speech-dispatcher normally runs locally. This quirk means a strict `localService` filter hides most Linux voices.                                                                                                                                                                 |
| Android                   | [SpeechSynthesisService.cpp](https://github.com/mozilla-firefox/firefox/blob/main/dom/media/webspeech/synth/android/SpeechSynthesisService.cpp) and [GeckoView SpeechSynthesisService.java](https://github.com/mozilla-firefox/firefox/blob/main/mobile/android/geckoview/src/main/java/org/mozilla/gecko/SpeechSynthesisService.java) | `true` only when the engine lists `KEY_FEATURE_EMBEDDED_SYNTHESIS` for that locale. That key means the engine "must synthesize text on-device (without making network requests)" ([TextToSpeech.Engine](https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine)). Firefox for Android is the only mobile browser found that checks this. |

### Safari and every iOS browser (WebKit)

- **`localService` and `default` are always `true`.** WebKit lists
  AVFoundation voices with `speechVoicesIncludingSuperCompact` and keeps only
  those where `voice.isSystemVoice`. Each one is created with `localService`
  hard-coded to `true`, and `isDefault` also hard-coded to `true`
  ([PlatformSpeechSynthesizerCocoa.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm)).
  So `default` is useless on Safari.
- **No cloud voices.** No WebKit voice is remote; they all come from the OS's
  speech synthesizer.
- **How WebKit picks a voice.** It looks the voice up by `voiceURI`. If that
  fails, it falls back to `voiceWithLanguage:` using the utterance's `lang`, or
  the current language if `lang` is unset.
- **Only low-quality voices are listed.** Safari exposes only pre-installed,
  lower-quality voices. Enhanced or premium voices that people download in
  Settings > Accessibility > Spoken Content are not listed. This is
  [WebKit bug 290497](https://bugs.webkit.org/show_bug.cgi?id=290497), still
  open. On iOS 18, some compact voices disappeared from the list on real
  devices
  ([Apple Developer Forums](https://developer.apple.com/forums/thread/764438)).
- **The list has regressed before.**
  - [Bug 250665](https://bugs.webkit.org/show_bug.cgi?id=250665): the Kyoko
    (ja-JP) voice disappeared in iOS 16.0.2.
  - [Bug 216684](https://bugs.webkit.org/show_bug.cgi?id=216684): voice names
    were empty on iOS 14.
- **`voiceschanged` arrived late.** Safari supports it only from version 16
  ([browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechSynthesis.json)).

## How to pick a voice for a language

From the facts above:

1. **Wait for the list.** Call `getVoices()`, and call it again on
   `voiceschanged`. It can be empty at first (spec), and on Safari before 16
   the event never fires.
2. **Normalize `voice.lang`** by replacing `_` with `-` (Chrome on Android) and
   comparing case-insensitively.
3. **Keep only voices whose primary language subtag matches** the glossary
   language, and prefer an exact region match. This mirrors Chrome's own
   scoring.
4. **Keep only voices with `localService === true`.** This removes Chrome's
   Google voices and (probably) Edge's Online voices.
5. **Set `utterance.voice` to the chosen voice and also set `utterance.lang`.**
   Do not rely on the browser's default. Ignore `voice.default`, which is
   always `true` on Safari.
6. **If nothing is left, hide or disable "speak"** for that glossary language
   on that device.

## Mobile and other quirks

- **A user gesture is required.** Chrome 71 removed `speak()` without user
  activation; it now throws. The Chrome release notes say Firefox deprecated
  the same behaviour and Safari removed it
  ([Chrome 71 deprecations](https://developer.chrome.com/blog/chrome-71-deps-rems/)).
  Call `speak()` directly from the tap or click handler.
- **Voice choice on Android is by language only** in Chrome, and it uses
  whatever engine the user has set as default.
- **Voice lists differ by device.** They depend on the OS, its version, the
  installed language packs, and (in Chrome) the network type. Do not hard-code
  voice names.
- **In-app browsers on Android** (Android WebView) have no `speechSynthesis`.
  On iOS, in-app browsers use WebKit and behave like Safari.

## Recommendation (input for a later decision ticket, not a decision)

- **Use the Web Speech API for audio. Do not bundle or fetch a TTS model.**
  Every target browser has it, it costs nothing, and it needs no server.
- **Never speak through a voice the browser reports as remote.** Always pick
  the voice explicitly: filter `getVoices()` to `localService === true` and
  match the glossary language, as in the steps above. Never set only `lang`;
  in desktop Chrome that can send the term to Google.
- **Hide or disable the speak button when no local voice exists** for a
  language on the current device, and tell the user why ("No on-device voice
  for Korean on this device"). Do not fall back to a remote voice.
- **State the limit honestly in the spec.** `localService` is the browser's own
  claim. Chrome on Android and Safari report `true` for every voice without
  checking. dictio can promise "we never choose a voice the browser reports as
  remote", but not more than that.
- **Do not let speech constrain the fixed language list.** Which voices exist
  depends on each device, not on the language, so treat audio as a per-device
  enhancement that is present or absent.
- **Expect lower voice quality on iOS**, because of WebKit bug 290497.

## Open questions for the decision ticket

- **What do Edge's "Online (Natural)" voices actually report** for
  `localService`? Microsoft does not document it, so check it on a real Edge
  install before relying on the filter.
- **Is the "best effort" privacy wording acceptable** given that Chrome on
  Android and Safari cannot tell local voices from remote ones? Or should audio
  be disabled on Chrome for Android, where the engine might use the network?
- **Should Linux voices be allowed?** Firefox on Linux reports most
  speech-dispatcher voices as non-local even though they are usually local. Do
  we accept that it hides them, or special-case it?
- **How should the UI explain a missing voice**, and should it point users to
  their OS settings to install one?
- **Is a short device test worth running** before the Later spec is locked? It
  would list `getVoices()` on iOS Safari, Chrome for Android, desktop Chrome,
  and Edge for the candidate languages.
