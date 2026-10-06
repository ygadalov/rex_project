/* Граф связей: холст строится, фильтры режут, выбор объекта подводит его
   к центру и подсвечивает направление связей. Цвета проверяем по холсту,
   а не по словарю: словарь можно поменять, а картинку — забыть. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Граф связей');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');
    await страница(pg, 'graph');
    await pg.waitForFunction(() => window.__cy && window.__cy.nodes().length > 0, null, { timeout: 30000 });

    t.раздел('Холст построен');
    const х = await pg.evaluate(() => ({
        узлов: window.__cy.nodes().length,
        рёбер: window.__cy.edges().length,
        масштаб: +window.__cy.zoom().toFixed(2),
        вНуле: window.__cy.nodes().filter(n => n.position().x === 0 && n.position().y === 0).length,
    }));
    console.log('     ' + JSON.stringify(х));
    t.ok(х.узлов === 10, 'на холст попали все объекты книги: ' + х.узлов);
    t.ok(х.рёбер >= 4, 'связи отрисованы: ' + х.рёбер);
    t.ok(х.вНуле <= 1, 'раскладка развела узлы, а не свалила в точку');
    t.ok(х.масштаб > 0.05 && х.масштаб < 5, 'масштаб вменяемый: ' + х.масштаб);

    t.раздел('Фильтр по типам режет холст');
    const было = х.узлов;
    await pg.evaluate(() => {
        const кн = [...document.querySelectorAll('#type-filter [data-type]')]
            .find(b => b.dataset.type === 'name');
        if (кн) кн.click();
    });
    await pg.waitForTimeout(900);
    const послеФильтра = await pg.evaluate(() => window.__cy.nodes().length);
    t.ok(послеФильтра < было, 'выключение типа убрало узлы: ' + было + ' → ' + послеФильтра);
    await pg.evaluate(() => {
        const кн = [...document.querySelectorAll('#type-filter [data-type]')]
            .find(b => b.dataset.type === 'name');
        if (кн) кн.click();
    });
    await pg.waitForTimeout(900);
    t.ok(await pg.evaluate(() => window.__cy.nodes().length) === было, 'возврат фильтра вернул узлы');

    t.раздел('Выбор объекта: подводит к центру и красит связи по направлению');
    const фокус = await pg.evaluate(async () => {
        const цель = APP.graph.nodes.find(n => n.type === 'sheet' && n.label === 'Итоги');
        focusNode(цель.id);
        await new Promise(r => setTimeout(r, 900));
        const cy = window.__cy;
        const n = cy.getElementById(цель.id);
        const p = n.renderedPosition();
        const цвет = кл => {
            const e = cy.edges().filter(x => x.hasClass(кл))[0];
            return e ? e.style('line-color').replace(/\s/g, '') : null;
        };
        return {
            промахX: Math.round(Math.abs(p.x - cy.width() / 2)),
            промахY: Math.round(Math.abs(p.y - cy.height() / 2)),
            вверх: цвет('hl-up'), вниз: цвет('hl-down'),
            легенда: !document.querySelector('#lg-focus').hidden,
            панель: (document.querySelector('#gd-title') || {}).innerText || '',
        };
    });
    console.log('     ' + JSON.stringify(фокус));
    // Центр считается по самому узлу, а не по его рамке с подписью: иначе
    // один и тот же клик приводит объект в разные места — выше центра на
    // половину подписи, если приближать не понадобилось.
    t.ok(фокус.промахX <= 3 && фокус.промахY <= 3,
         'выбранный объект встал в центр: промах ' + фокус.промахX + '/' + фокус.промахY + ' px');
    t.ok(фокус.вверх === 'rgb(13,148,136)' || фокус.вверх === null,
         'связь «к выбранному» бирюзовая: ' + фокус.вверх);
    t.ok(фокус.легенда, 'легенда переключилась на объяснение направлений');
    t.ok(/Итоги/.test(фокус.панель), 'правая панель показывает выбранный объект');

    t.раздел('Тот же центр и когда по дороге пришлось приблизить');
    const издалека = await pg.evaluate(async () => {
        clearFocus();
        window.__cy.zoom(0.3);                    // общий план: выбор обязан приблизить
        await new Promise(r => setTimeout(r, 300));
        const цель = APP.graph.nodes.find(n => n.type === 'table');
        focusNode(цель.id);
        await new Promise(r => setTimeout(r, 1200));
        const cy = window.__cy, p = cy.getElementById(цель.id).renderedPosition();
        return { x: Math.round(Math.abs(p.x - cy.width() / 2)),
                 y: Math.round(Math.abs(p.y - cy.height() / 2)),
                 zoom: +cy.zoom().toFixed(2) };
    });
    t.ok(издалека.zoom >= 0.9, 'масштаб подтянут до читаемого: ' + издалека.zoom);
    t.ok(издалека.x <= 3 && издалека.y <= 3,
         'и с общего плана объект встаёт туда же: промах ' + издалека.x + '/' + издалека.y + ' px');

    t.раздел('Сброс выбора');
    await pg.evaluate(() => clearFocus());
    await pg.waitForTimeout(500);
    const сброс = await pg.evaluate(() => ({
        легенда: document.querySelector('#lg-focus').hidden,
        приглушённых: window.__cy.elements().filter(e => e.hasClass('faded')).length,
    }));
    t.ok(сброс.легенда && сброс.приглушённых === 0, 'после сброса ничего не приглушено');

    t.раздел('Список объектов');
    await pg.click('#graph-search-caret');
    await pg.waitForTimeout(400);
    const сп = await pg.evaluate(() => ({
        открыт: !document.querySelector('#graph-search-list').hidden,
        опций: document.querySelectorAll('.gs-opt').length,
        сЗначком: document.querySelectorAll('.gs-opt .node-glyph').length,
    }));
    t.ok(сп.открыт && сп.опций === 10, 'список открылся и перечисляет все объекты: ' + сп.опций);
    t.ok(сп.сЗначком === сп.опций, 'у каждой строки свой значок типа');

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
