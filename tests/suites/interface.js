/* Интерфейс: подсказки (i) и вёрстка заголовков. Сюда собраны ровно те
   места, где уже находились ошибки, — значок, оторвавшийся от своего
   текста, и заголовок «Графа», съехавший относительно остальных
   разделов. Проверка существует, чтобы они не вернулись. */
const { браузер, открыть, страница, счёт } = require('../harness');

const РАЗДЕЛЫ = ['upload', 'overview', 'sheets', 'formulas', 'model', 'quality', 'cleanup'];

module.exports = async function () {
    const t = счёт('Интерфейс: подсказки и вёрстка');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');

    t.раздел('Подсказки раскрываются по наведению и закрываются при уходе');
    await страница(pg, 'cleanup');
    const п = await pg.evaluate(async () => {
        const кн = document.querySelector('#cleanup-why .ib');
        кн.dispatchEvent(new MouseEvent('mouseenter'));
        await new Promise(r => setTimeout(r, 120));
        const открыта = document.querySelector('.ib-pop');
        const текст = открыта ? открыта.innerText.trim() : '';
        кн.dispatchEvent(new MouseEvent('mouseleave'));
        await new Promise(r => setTimeout(r, 400));
        return { текст, закрылась: !document.querySelector('.ib-pop'),
                 разметкаЦела: открыта ? открыта.querySelectorAll('code, b').length : 0 };
    });
    t.ok(п.текст.length > 50, 'пояснение раскрылось: ' + п.текст.slice(0, 60) + '…');
    t.ok(п.закрылась, 'после увода курсора закрылось');
    t.ok(п.разметкаЦела > 0, 'разметка внутри пояснения доехала целой');

    t.раздел('Подсказка открывается и по клавиатуре');
    const кл = await pg.evaluate(async () => {
        const кн = document.querySelector('#cleanup-why .ib');
        кн.focus();
        await new Promise(r => setTimeout(r, 150));
        const есть = !!document.querySelector('.ib-pop');
        кн.blur();
        await new Promise(r => setTimeout(r, 400));
        return { есть, ушла: !document.querySelector('.ib-pop') };
    });
    t.ok(кл.есть && кл.ушла, 'фокус с клавиатуры открывает и закрывает пояснение');

    t.раздел('Ни один значок не оторвался от своего текста');
    const оторвались = [];
    let всего = 0;
    for (const раздел of РАЗДЕЛЫ) {
        await страница(pg, раздел);
        const r = await pg.evaluate(() => {
            const плохие = [];
            const кнопки = [...document.querySelectorAll('.page-content.active .ib')];
            кнопки.forEach(b => {
                // Кнопка часто лежит в пустой обёртке-якоре: текст слева тогда
                // у родителя, поднимаемся, пока элемент первый в своём узле.
                let узел = b, пред = null;
                while (узел && !(пред = узел.previousSibling)) узел = узел.parentElement;
                if (!пред) return;
                const rg = document.createRange();
                rg.selectNodeContents(пред);
                const прямоугольники = [...rg.getClientRects()];
                if (!прямоугольники.length) return;
                const последний = прямоугольники[прямоугольники.length - 1];
                const свой = b.getBoundingClientRect();
                const разбег = Math.abs((последний.top + последний.height / 2) -
                                        (свой.top + свой.height / 2));
                if (разбег > 4) плохие.push((пред.textContent || '').trim().slice(0, 40) +
                                            ' (+' + Math.round(разбег) + 'px)');
            });
            return { плохие, всего: кнопки.length };
        });
        всего += r.всего;
        r.плохие.forEach(x => оторвались.push(раздел + ': ' + x));
    }
    t.ok(всего >= 15, 'подсказки расставлены по разделам: ' + всего + ' шт.');
    t.ok(!оторвались.length, 'значок всегда на строке своего текста'
         + (оторвались.length ? ' — ' + оторвались.slice(0, 4).join('; ') : ''));

    t.раздел('Заголовок раздела стоит одинаково везде, включая «Граф»');
    for (const [ш, в] of [[1000, 900], [1450, 950]]) {
        await pg.setViewportSize({ width: ш, height: в });
        await pg.waitForTimeout(400);
        const мера = {};
        for (const раздел of ['sheets', 'quality', 'graph']) {
            await страница(pg, раздел);
            мера[раздел] = await pg.evaluate(() => {
                const шапка = document.querySelector('.page-content.active .header-top');
                const моб = document.querySelector('.mobile-header');
                const видна = моб && getComputedStyle(моб).display !== 'none';
                let след = шапка.nextElementSibling;
                while (след && !след.getBoundingClientRect().height) след = след.nextElementSibling;
                const r = шапка.getBoundingClientRect();
                return { верх: Math.round(r.top),
                         сверху: видна ? Math.round(r.top - моб.getBoundingClientRect().bottom) : null,
                         снизу: след ? Math.round(след.getBoundingClientRect().top - r.bottom) : null };
            });
        }
        const э = мера.sheets, г = мера.graph;
        t.ok(г.верх === э.верх && г.сверху === э.сверху && г.снизу === э.снизу,
             ш + 'px: «Граф» стоит как «Листы» — ' + JSON.stringify(г) + ' против ' + JSON.stringify(э));
        if (г.сверху !== null) t.ok(г.сверху > 0, ш + 'px: заголовок не подпирает шапку');
    }
    await pg.setViewportSize({ width: 1450, height: 950 });

    t.раздел('Строки индекса здоровья не переносятся');
    await страница(pg, 'overview');
    const инд = await pg.evaluate(() => [...document.querySelectorAll('.health-bar-row')].map(r => {
        const подпись = r.querySelector('span'), значок = r.querySelector('.ib');
        const a = подпись.getBoundingClientRect(), c = значок.getBoundingClientRect();
        return { высота: Math.round(a.height),
                 наСтроке: Math.abs((a.top + a.height / 2) - (c.top + c.height / 2)) < 3,
                 полоса: Math.round(r.querySelector('.health-bar-track').getBoundingClientRect().width) };
    }));
    t.ok(инд.length === 5 && инд.every(x => x.наСтроке && x.высота <= 22),
         'все пять строк в одну линию со значком');
    t.ok(инд.every(x => x.полоса >= 60), 'полоса не задавлена: ' + Math.min(...инд.map(x => x.полоса)) + 'px');

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
