(function () {
    'use strict';

    /*
     * Lampa VIDAA Native Player Test
     * v0.1.0
     *
     * Purpose:
     *   Intercept Filmix/MP4 playback in Lampa and try the VIDAA native-player
     *   handoff used by the community Stremio VIDAA project.
     *
     * This is intentionally a TEST plugin:
     *   - It does not modify Filmix source parsing.
     *   - It uses the URL already produced by Lampa.Player.play().
     *   - It reports which Hisense/VIDAA APIs are visible.
     *   - It falls back to the normal Lampa player if native handoff fails.
     */

    var VERSION = '0.1.0';
    var LOG = '[Lampa VIDAA Native]';

    function log() {
        try {
            console.log.apply(console, [LOG].concat([].slice.call(arguments)));
        } catch (e) {}
    }

    /*
     * Проверяем наличие известных VIDAA/Hisense API.
     */
    function apiSnapshot() {
        var w = window;

        var result = {
            userAgent: navigator.userAgent || '',
            href: location.href || '',

            hisense: {},

            omi_platform: false,
            sendPlatformMessage: false
        };

        [
            'Hisense_GetDeviceID',
            'Hisense_GetFirmWareVersion',
            'Hisense_GetCountryCode',
            'Hisense_GetModelName',
            'Hisense_Exit',
            'Hisense_RegisterObserver',
            'Hisense_installApp'
        ].forEach(function (name) {
            result.hisense[name] = typeof w[name] === 'function';
        });

        try {
            result.omi_platform =
                typeof w.omi_platform !== 'undefined';

            result.sendPlatformMessage =
                result.omi_platform &&
                typeof w.omi_platform.sendPlatformMessage === 'function';
        } catch (e) {}

        return result;
    }

    /*
     * Безопасный вызов Hisense_* функции.
     */
    function safeCall(name) {
        try {
            if (typeof window[name] !== 'function') {
                return {
                    available: false,
                    value: null,
                    error: null
                };
            }

            var value = window[name]();

            return {
                available: true,
                value: value == null ? null : String(value),
                error: null
            };

        } catch (e) {
            return {
                available: true,
                value: null,
                error: e && e.message
                    ? e.message
                    : String(e)
            };
        }
    }

    /*
     * Полная диагностика.
     */
    function diagnostics() {
        var s = apiSnapshot();

        s.values = {
            Hisense_GetDeviceID:
                safeCall('Hisense_GetDeviceID'),

            Hisense_GetFirmWareVersion:
                safeCall('Hisense_GetFirmWareVersion'),

            Hisense_GetCountryCode:
                safeCall('Hisense_GetCountryCode'),

            Hisense_GetModelName:
                safeCall('Hisense_GetModelName')
        };

        return s;
    }

    /*
     * Определяем MIME по URL.
     */
    function mime(url) {
        var path = String(url || '')
            .split('?')[0]
            .toLowerCase();

        if (path.indexOf('.mkv') !== -1) {
            return 'video/x-matroska';
        }

        if (path.indexOf('.m3u8') !== -1) {
            return 'application/vnd.apple.mpegurl';
        }

        if (path.indexOf('.mpd') !== -1) {
            return 'application/dash+xml';
        }

        if (path.indexOf('.webm') !== -1) {
            return 'video/webm';
        }

        if (path.indexOf('.mov') !== -1) {
            return 'video/quicktime';
        }

        return 'video/mp4';
    }

    /*
     * Консервативная проверка Filmix/MP4.
     *
     * Мы пока не хотим перехватывать TorrServer.
     */
    function isFilmixUrl(url) {
        url = String(url || '').toLowerCase();

        return (
            /\.mp4(?:$|[?#])/.test(url) ||
            url.indexOf('filmix') !== -1 ||
            (
                url.indexOf('cdn') !== -1 &&
                url.indexOf('.mp4') !== -1
            )
        );
    }

    /*
     * Получаем название из объекта Lampa Player.
     */
    function getTitle(play) {
        try {
            if (play && play.title) {
                return String(play.title);
            }
        } catch (e) {}

        return 'Lampa';
    }

    /*
     * Выводим диагностику.
     */
    function showDiagnostics() {
        var d = diagnostics();

        log('VIDAA API diagnostics:', d);

        var lines = [];

        lines.push(
            'Lampa VIDAA Native v' + VERSION
        );

        lines.push('');

        lines.push('Hisense API:');

        Object.keys(d.hisense).forEach(function (name) {
            lines.push(
                (d.hisense[name] ? '✓ ' : '✗ ') + name
            );
        });

        lines.push('');

        lines.push(
            'omi_platform: ' +
            (d.omi_platform ? '✓' : '✗')
        );

        lines.push(
            'sendPlatformMessage: ' +
            (d.sendPlatformMessage ? '✓' : '✗')
        );

        Object.keys(d.values).forEach(function (name) {
            var item = d.values[name];

            if (item.available) {
                lines.push('');

                lines.push(
                    name +
                    ': ' +
                    (
                        item.error
                            ? 'ERROR: ' + item.error
                            : (item.value || 'OK')
                    )
                );
            }
        });

        var text = lines.join('\n');

        /*
         * Короткое уведомление в Lampa.
         * Полная информация остаётся в console.log().
         */
        if (
            typeof Lampa !== 'undefined' &&
            Lampa.Noty &&
            Lampa.Noty.show
        ) {
            Lampa.Noty.show(
                'VIDAA: ' +
                (
                    d.sendPlatformMessage
                        ? 'omi_platform.sendPlatformMessage доступен'
                        : 'native API не найден'
                )
            );
        }

        log(text);

        return d;
    }

    /*
     * Проверяем, ушёл ли WebView в background.
     *
     * Это НЕ является гарантией запуска native player.
     *
     * Это лишь косвенный признак того, что VIDAA перехватил
     * platform message и начал переход.
     */
    function verifyBackgrounding(ms) {
        return new Promise(function (resolve) {
            var settled = false;

            function done(ok) {
                if (settled) {
                    return;
                }

                settled = true;

                document.removeEventListener(
                    'visibilitychange',
                    visibility
                );

                window.removeEventListener(
                    'blur',
                    blur
                );

                window.removeEventListener(
                    'pagehide',
                    pagehide
                );

                resolve(ok);
            }

            function visibility() {
                if (
                    document.visibilityState === 'hidden'
                ) {
                    done(true);
                }
            }

            function blur() {
                done(true);
            }

            function pagehide() {
                done(true);
            }

            document.addEventListener(
                'visibilitychange',
                visibility
            );

            window.addEventListener(
                'blur',
                blur
            );

            window.addEventListener(
                'pagehide',
                pagehide
            );

            setTimeout(function () {
                done(false);
            }, ms || 2500);
        });
    }

    /*
     * Попытка запуска native player.
     */
    function launchNative(url, title) {
        var d = apiSnapshot();

        if (!d.sendPlatformMessage) {
            log(
                'Native API unavailable'
            );

            return Promise.resolve(false);
        }

        url = String(url || '');

        if (!url) {
            log('No URL');

            return Promise.resolve(false);
        }

        /*
         * Тестовые сообщения.
         *
         * ВАЖНО:
         * Это экспериментальная часть.
         *
         * Если конкретная U9 прошивка использует другой payload,
         * этот вызов не сработает.
         */
        var messages = [
            {
                type: 'launchNativePlayer',

                url: url,

                title: title || 'Lampa',

                mimeType: mime(url)
            },

            {
                type: 'openMediaPlayer',

                url: url,

                title: title || 'Lampa'
            },

            {
                type: 'playVideo',

                url: url,

                mimeType: mime(url),

                title: title || 'Lampa'
            }
        ];

        /*
         * Начинаем наблюдение ДО отправки сообщения.
         */
        var verification =
            verifyBackgrounding(2500);

        messages.forEach(function (message) {
            try {
                var payload =
                    JSON.stringify(message);

                log(
                    'sendPlatformMessage:',
                    payload
                );

                window
                    .omi_platform
                    .sendPlatformMessage(payload);

            } catch (e) {
                log(
                    'sendPlatformMessage threw:',
                    e
                );
            }
        });

        return verification.then(function (opened) {

            log(
                'Native handoff result:',
                opened
                    ? 'BACKGROUNDING DETECTED'
                    : 'NO BACKGROUNDING'
            );

            return opened;
        });
    }

    /*
     * Перехватываем Lampa.Player.play().
     */
    function installPlayerHook() {

        if (
            !window.Lampa ||
            !Lampa.Player ||
            typeof Lampa.Player.play !== 'function'
        ) {
            log(
                'Lampa.Player.play is not available yet'
            );

            return false;
        }

        /*
         * Не устанавливаем hook второй раз.
         */
        if (
            Lampa.Player.__vidaaNativeHookInstalled
        ) {
            return true;
        }

        var original =
            Lampa.Player.play;

        Lampa.Player.play = function (play) {

            try {
                var url =
                    play && play.url;

                /*
                 * Пока перехватываем только Filmix/MP4.
                 */
                if (
                    url &&
                    isFilmixUrl(url)
                ) {
                    log(
                        'Intercepting Filmix/MP4:',
                        url
                    );

                    /*
                     * Сначала диагностика.
                     */
                    showDiagnostics();

                    /*
                     * Затем native handoff.
                     */
                    launchNative(
                        url,
                        getTitle(play)
                    ).then(function (opened) {

                        /*
                         * Если native player не забрал
                         * управление — возвращаем стандартный
                         * Lampa player.
                         */
                        if (!opened) {

                            log(
                                'Native handoff failed; ' +
                                'falling back to Lampa player'
                            );

                            try {
                                original.call(
                                    Lampa.Player,
                                    play
                                );
                            } catch (e) {
                                log(
                                    'Fallback player error:',
                                    e
                                );
                            }
                        }
                    });

                    return;
                }

            } catch (e) {

                log(
                    'Hook error:',
                    e
                );
            }

            /*
             * Все остальные URL идут обычному Lampa Player.
             */
            return original.apply(
                Lampa.Player,
                arguments
            );
        };

        Lampa.Player.__vidaaNativeHookInstalled =
            true;

        log(
            'Player hook installed'
        );

        return true;
    }

    /*
     * Запуск плагина.
     */
    function boot() {

        log(
            'Starting v' + VERSION
        );

        /*
         * Первичная диагностика.
         */
        var d =
            showDiagnostics();

        /*
         * Lampa может инициализировать Player
         * чуть позже самого плагина.
         *
         * Поэтому несколько раз проверяем.
         */
        var attempts = 0;

        var timer =
            setInterval(function () {

                attempts++;

                if (
                    installPlayerHook() ||
                    attempts >= 40
                ) {
                    clearInterval(timer);
                }

            }, 500);

        /*
         * Глобальный объект для ручного тестирования
         * через console.
         *
         * Примеры:
         *
         * LampaVIDAANative.diagnostics()
         *
         * LampaVIDAANative.native(
         *     "http://PC:8765/test.mp4",
         *     "Test"
         * )
         */
        window.LampaVIDAANative = {

            version: VERSION,

            diagnostics:
                diagnostics,

            native:
                launchNative,

            mime:
                mime,

            isFilmixUrl:
                isFilmixUrl
        };

        return d;
    }

    /*
     * Bootstrap.
     */
    if (
        document.readyState === 'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            boot
        );

    } else {

        boot();
    }

})();
