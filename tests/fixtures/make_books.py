#!/usr/bin/env python3
"""Сборка книг для проверок.

Книги собираются из голого OOXML, а не из готовой библиотеки: нам нужны
вещи, которых ни одна библиотека по-человечески не даёт — скрытые имена
(hidden="1"), ссылки #REF!, запросы Power Query в DataMashup, листы
veryHidden. Их приходится писать в XML руками.

Данные внутри — выдуманные. Настоящие рабочие книги в репозиторий не
кладём: в них коммерческие сведения, а проверкам нужна не правда жизни,
а конкретные признаки.

    python3 make_books.py [каталог]     # по умолчанию рядом со скриптом
"""
import os
import sys
import zipfile

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>
<Override PartName="/xl/workbook.xml" ContentType="{wb}"/>
{sheets}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
{tables}
</Types>'''

RELS_ROOT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

CORE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>{title}</dc:title><dc:creator>Иванова А. П.</dc:creator>
<cp:lastModifiedBy>Петров С. С.</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2024-02-11T08:30:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-20T14:05:00Z</dcterms:modified>
</cp:coreProperties>'''

APP = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Microsoft Excel</Application><Company>ООО «Пример»</Company><AppVersion>16.0300</AppVersion>
</Properties>'''

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs>
</styleSheet>'''


def ячейка(ссылка, знач=None, формула=None, строка_idx=None, ошибка=None):
    if формула is not None:
        # Excel хранит рядом с формулой её последний посчитанный результат.
        # Для ошибок он помечает ячейку t="e" — по этому признаку REX их и
        # находит, одной формулы ему мало.
        if ошибка:
            return '<c r="%s" t="e"><f>%s</f><v>%s</v></c>' % (ссылка, формула, ошибка)
        return '<c r="%s"><f>%s</f><v>0</v></c>' % (ссылка, формула)
    if строка_idx is not None:
        return '<c r="%s" t="s"><v>%d</v></c>' % (ссылка, строка_idx)
    return '<c r="%s"><v>%s</v></c>' % (ссылка, знач)


def лист(строки, размеры=None):
    тело = ''.join('<row r="%d">%s</row>' % (н, ''.join(c)) for н, c in строки)
    габарит = размеры or ('A1:%s' % ('J%d' % (len(строки) + 1) if строки else 'A1'))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<dimension ref="%s"/><sheetData>%s</sheetData></worksheet>' % (габарит, тело))


class Книга:
    """Собирает .xlsx/.xlsm по частям. Ничего не проверяет — это заготовка
       для проверок, а не редактор: кривое на входе должно доехать до REX."""

    def __init__(self, имя):
        self.имя = имя
        self.листы = []          # (имя, xml, состояние)
        self.строки = []         # общая таблица строк
        self.имена = []          # (имя, ссылка, скрыто, локальный лист)
        self.таблицы = []        # (имя, диапазон, лист_idx, колонки)
        self.внешние = []        # пути к книгам-источникам
        self.vba = False
        self.mashup = None
        self.calc = 'auto'

    def строка(self, s):
        if s not in self.строки:
            self.строки.append(s)
        return self.строки.index(s)

    def лист(self, имя, строки, состояние='visible', размеры=None):
        self.листы.append((имя, лист(строки, размеры), состояние))
        return len(self.листы)

    def записать(self, путь):
        расш = os.path.splitext(путь)[1]
        wb_ct = ('application/vnd.ms-excel.sheet.macroEnabled.main+xml' if расш == '.xlsm'
                 else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')
        sheet_ct = ''.join(
            '<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1)
            for i in range(len(self.листы)))
        table_ct = ''.join(
            '<Override PartName="/xl/tables/table%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' % (i + 1)
            for i in range(len(self.таблицы)))

        # ── workbook.xml
        листы_xml = ''.join(
            '<sheet name="%s" sheetId="%d" r:id="rId%d"%s/>'
            % (имя, i + 1, i + 1, '' if сост == 'visible' else ' state="%s"' % сост)
            for i, (имя, _, сост) in enumerate(self.листы))
        имена_xml = ''
        if self.имена:
            имена_xml = '<definedNames>' + ''.join(
                '<definedName name="%s"%s%s>%s</definedName>'
                % (имя, ' hidden="1"' if скрыто else '',
                   ' localSheetId="%d"' % лок if лок is not None else '', ссылка)
                for имя, ссылка, скрыто, лок in self.имена) + '</definedNames>'
        calc_xml = '<calcPr calcId="191029"%s/>' % (
            ' calcMode="manual"' if self.calc == 'manual' else '')
        # Часть externalLink сама по себе не считается: книга должна на неё
        # сослаться через externalReference, иначе Excel её игнорирует.
        внеш_xml = ''
        if self.внешние:
            первый = len(self.листы) + 3
            внеш_xml = '<externalReferences>' + ''.join(
                '<externalReference r:id="rId%d"/>' % (первый + i)
                for i in range(len(self.внешние))) + '</externalReferences>'
        wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
              'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
              '<sheets>%s</sheets>%s%s%s</workbook>'
              % (листы_xml, имена_xml, внеш_xml, calc_xml))

        # ── связи книги
        рел = []
        for i in range(len(self.листы)):
            рел.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1))
        сдвиг = len(self.листы)
        рел.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' % (сдвиг + 1))
        рел.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' % (сдвиг + 2))
        n = сдвиг + 3
        for i in range(len(self.внешние)):
            рел.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink%d.xml"/>' % (n, i + 1))
            n += 1
        if self.vba:
            рел.append('<Relationship Id="rId%d" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>' % n)
            n += 1
        wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>'
                   % ''.join(рел))

        with zipfile.ZipFile(путь, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('[Content_Types].xml', CT.format(wb=wb_ct, sheets=sheet_ct, tables=table_ct))
            z.writestr('_rels/.rels', RELS_ROOT)
            z.writestr('docProps/core.xml', CORE.format(title=self.имя))
            z.writestr('docProps/app.xml', APP)
            z.writestr('xl/workbook.xml', wb)
            z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
            z.writestr('xl/styles.xml', STYLES)
            сс = ''.join('<si><t xml:space="preserve">%s</t></si>' % s for s in self.строки)
            z.writestr('xl/sharedStrings.xml',
                       '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                       '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                       'count="%d" uniqueCount="%d">%s</sst>' % (len(self.строки), len(self.строки), сс))
            for i, (_, xml, _) in enumerate(self.листы):
                z.writestr('xl/worksheets/sheet%d.xml' % (i + 1), xml)
            # умные таблицы
            for i, (имя, диап, лист_idx, колонки) in enumerate(self.таблицы):
                кол = ''.join('<tableColumn id="%d" name="%s"/>' % (k + 1, c) for k, c in enumerate(колонки))
                z.writestr('xl/tables/table%d.xml' % (i + 1),
                           '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                           '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                           'id="%d" name="%s" displayName="%s" ref="%s" totalsRowShown="0">'
                           '<tableColumns count="%d">%s</tableColumns></table>'
                           % (i + 1, имя, имя, диап, len(колонки), кол))
                z.writestr('xl/worksheets/_rels/sheet%d.xml.rels' % лист_idx,
                           '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                           '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                           '<Relationship Id="rIdT%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table%d.xml"/>'
                           '</Relationships>' % (i + 1, i + 1))
            # внешние книги
            for i, путь_ext in enumerate(self.внешние):
                z.writestr('xl/externalLinks/externalLink%d.xml' % (i + 1),
                           '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                           '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                           '<externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">'
                           '<sheetNames><sheetName val="Данные"/></sheetNames></externalBook></externalLink>')
                z.writestr('xl/externalLinks/_rels/externalLink%d.xml.rels' % (i + 1),
                           '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                           '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                           '<Relationship Id="rId1" TargetMode="External" '
                           'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" '
                           'Target="%s"/></Relationships>' % путь_ext)
            if self.vba:
                # не настоящий модуль: REX проверяет наличие части, а не её разбор
                z.writestr('xl/vbaProject.bin', b'\x00VBA-\x00\x00stub')
            if self.mashup:
                z.writestr('customXml/item1.xml', self.mashup)
        return путь


# ─────────────────────────── Power Query ───────────────────────────

def mashup(запросы):
    """Контейнер DataMashup: 4 байта версии, 4 байта длины zip, сам zip.
       Внутри zip — Formulas/Section1.m, откуда REX и читает M-код."""
    import base64
    import io
    import struct
    тело = 'section Section1;\r\n\r\n' + '\r\n\r\n'.join(
        'shared %s = let\r\n%s\r\nin\r\n    Результат;' % (имя, код) for имя, код in запросы)
    буфер = io.BytesIO()
    with zipfile.ZipFile(буфер, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('Config/Package.xml', '<?xml version="1.0"?><Package/>')
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types/>')
        z.writestr('Formulas/Section1.m', '\ufeff' + тело)
    zip_байты = буфер.getvalue()
    пакет = struct.pack('<II', 0, len(zip_байты)) + zip_байты
    b64 = base64.b64encode(пакет).decode()
    return ('<?xml version="1.0" encoding="utf-8"?>'
            '<DataMashup xmlns="http://schemas.microsoft.com/DataMashup">%s</DataMashup>' % b64)


# ─────────────────────────── сами книги ───────────────────────────

def ровная(каталог):
    """Опрятная книга: ничего лишнего. Нужна как точка отсчёта — на ней
       проверки убеждаются, что REX не выдумывает находок на пустом месте."""
    k = Книга('Бюджет отдела')
    заг = [k.строка(s) for s in ('Статья', 'План', 'Факт', 'Отклонение')]
    строки = [(1, [ячейка('A1', строка_idx=заг[0]), ячейка('B1', строка_idx=заг[1]),
                   ячейка('C1', строка_idx=заг[2]), ячейка('D1', строка_idx=заг[3])])]
    for н in range(2, 12):
        строки.append((н, [
            ячейка('A%d' % н, строка_idx=k.строка('Статья %d' % (н - 1))),
            ячейка('B%d' % н, знач=н * 1000),
            ячейка('C%d' % н, знач=н * 950),
            ячейка('D%d' % н, формула='C%d-B%d' % (н, н)),
        ]))
    k.лист('Расчёт', строки, размеры='A1:D11')

    свод = [(1, [ячейка('A1', строка_idx=k.строка('Итого план')),
                 ячейка('B1', формула='SUM(Расчёт!B2:B11)')]),
            (2, [ячейка('A2', строка_idx=k.строка('Итого факт')),
                 ячейка('B2', формула='SUM(Расчёт!C2:C11)')])]
    k.лист('Свод', свод, размеры='A1:B2')

    k.таблицы.append(('Бюджет', 'A1:D11', 1, ['Статья', 'План', 'Факт', 'Отклонение']))
    k.имена.append(('Итого_план', 'Свод!$B$1', False, None))
    return k.записать(os.path.join(каталог, 'clean.xlsx'))


def запущенная(каталог):
    """Книга со всем, что REX умеет находить: скрытые имена четырёх групп,
       ссылки #REF!, лист veryHidden, ручной пересчёт, макросы, внешняя
       книга на локальном диске, порванная формульная колонка, лист-сирота."""
    k = Книга('Модель расчёта')
    k.vba = True
    k.calc = 'manual'
    k.внешние.append('file:///C:/Users/Ivanova/Desktop/Справочник%20цен.xlsx')

    заг = [k.строка(s) for s in ('Договор', 'Объём', 'Ставка', 'Сумма', 'Комментарий')]
    строки = [(1, [ячейка('A1', строка_idx=заг[0]), ячейка('B1', строка_idx=заг[1]),
                   ячейка('C1', строка_idx=заг[2]), ячейка('D1', строка_idx=заг[3]),
                   ячейка('E1', строка_idx=заг[4])])]
    for н in range(2, 32):
        клетки = [ячейка('A%d' % н, строка_idx=k.строка('Д-%03d' % (н - 1))),
                  ячейка('B%d' % н, знач=н * 7),
                  ячейка('C%d' % н, знач=120)]
        # колонка D протянута формулой, но в трёх строках её подменили руками
        if н in (9, 17, 24):
            клетки.append(ячейка('D%d' % н, знач=99999))
        else:
            клетки.append(ячейка('D%d' % н, формула='B%d*C%d' % (н, н)))
        клетки.append(ячейка('E%d' % н, строка_idx=k.строка('—')))
        строки.append((н, клетки))
    # ссылки на удалённый лист и деление на ноль
    строки.append((33, [ячейка('A33', строка_idx=k.строка('Проверка')),
                        ячейка('B33', формула='#REF!B1+1', ошибка='#REF!'),
                        ячейка('C33', формула='B33/0', ошибка='#DIV/0!'),
                        ячейка('D33', формула='VLOOKUP(A33,Договоры!A:D,4,0)', ошибка='#N/A'),
                        ячейка('E33', формула="INDIRECT(&quot;Лист1!A&quot;&amp;ROW())")]))
    k.лист('Договоры', строки, размеры='A1:E33')

    итоги = [(1, [ячейка('A1', строка_idx=k.строка('Выручка')),
                  ячейка('B1', формула='SUM(Договоры!D2:D31)')]),
             (2, [ячейка('A2', строка_idx=k.строка('Внешняя ставка')),
                  ячейка('B2', формула='[1]Данные!$A$1')]),
             (3, [ячейка('A3', строка_idx=k.строка('Вся колонка')),
                  ячейка('B3', формула='SUMIF(Договоры!A:A,&quot;Д-001&quot;,Договоры!D:D)')]),
             (4, [ячейка('A4', строка_idx=k.строка('Летучая')),
                  ячейка('B4', формула='TODAY()')])]
    k.лист('Итоги', итоги, размеры='A1:B4')

    # лист, на который никто не ссылается и который сам ни на что не ссылается
    сирота = [(н, [ячейка('A%d' % н, строка_idx=k.строка('архив %d' % н))]) for н in range(1, 6)]
    k.лист('Архив 2019', сирота, размеры='A1:A5')

    # спрятанные листы обоих видов
    k.лист('Служебный', [(1, [ячейка('A1', знач=1)])], состояние='hidden', размеры='A1:A1')
    k.лист('Параметры', [(1, [ячейка('A1', знач=42)])], состояние='veryHidden', размеры='A1:A1')

    k.таблицы.append(('Договоры_тбл', 'A1:E31', 1, ['Договор', 'Объём', 'Ставка', 'Сумма', 'Комментарий']))

    # ── имена. Видимые рабочие…
    k.имена.append(('Выручка', 'Итоги!$B$1', False, None))
    k.имена.append(('Ставка_база', 'Договоры!$C$2', False, None))
    # …видимое сломанное…
    k.имена.append(('Старый_диапазон', '#REF!$A$1:$B$9', False, None))
    # …и скрытый мусор четырёх происхождений
    for i in range(1, 25):
        k.имена.append(('BLPH%d' % i, "Договоры!$A$%d" % i, True, None))
    for i in range(1, 13):
        k.имена.append(('Отчёт_rwn%d_итог' % i, '#REF!$A$1', True, None))
    for i in range(1, 7):
        k.имена.append(('AS2_item%d' % i, 'Итоги!$A$1', True, None))
    for кор in ('aa', 'bb', 'zz', 'ww'):
        k.имена.append((кор, '#REF!$B$2', True, None))
    k.имена.append(('solver_lin', 'Итоги!$B$1', True, None))
    k.имена.append(('solver_typ', 'Итоги!$B$2', True, None))
    return k.записать(os.path.join(каталог, 'messy.xlsm'))


def с_запросами(каталог):
    """Power Query: источники всех видов и цепочка запрос → запрос."""
    k = Книга('Витрина продаж')
    заг = [k.строка(s) for s in ('Клиент', 'Сумма')]
    строки = [(1, [ячейка('A1', строка_idx=заг[0]), ячейка('B1', строка_idx=заг[1])])]
    for н in range(2, 9):
        строки.append((н, [ячейка('A%d' % н, строка_idx=k.строка('Клиент %d' % (н - 1))),
                           ячейка('B%d' % н, знач=н * 300)]))
    k.лист('Продажи', строки, размеры='A1:B8')
    k.лист('Отчёт', [(1, [ячейка('A1', формула='SUM(Продажи!B2:B8)')])], размеры='A1:A1')
    k.таблицы.append(('Продажи', 'A1:B8', 1, ['Клиент', 'Сумма']))

    k.mashup = mashup([
        ('Справочник_клиентов',
         '    Источник = Excel.Workbook(File.Contents("C:\\Обмен\\Клиенты.xlsx"), null, true),\r\n'
         '    Результат = Table.SelectColumns(Источник, {"Клиент", "Регион"})'),
        ('Выгрузка_CSV',
         '    Источник = Csv.Document(File.Contents("\\\\server\\share\\выгрузка.csv")),\r\n'
         '    Результат = Table.PromoteHeaders(Источник)'),
        ('Папка_актов',
         '    Источник = Folder.Files("D:\\Акты\\2026"),\r\n'
         '    Результат = Table.SelectRows(Источник, each [Extension] = ".xlsx")'),
        ('Из_базы',
         '    Источник = Sql.Database("sql-01", "Sales"),\r\n'
         '    Результат = Источник{[Schema="dbo",Item="Orders"]}[Data]'),
        ('Курс_ЦБ',
         '    Источник = Web.Contents("https://example.org/rates.json"),\r\n'
         '    Результат = Json.Document(Источник)'),
        ('Продажи_сводно',
         '    Источник = Справочник_клиентов,\r\n'
         '    Склейка = Table.NestedJoin(Источник, {"Клиент"}, Выгрузка_CSV, {"Клиент"}, "доп"),\r\n'
         '    Результат = Table.ExpandTableColumn(Склейка, "доп", {"Сумма"})'),
        ('Продажи',
         '    Источник = Продажи_сводно,\r\n'
         '    Результат = Table.Sort(Источник, {{"Сумма", Order.Descending}})'),
        ('Нигде_не_нужен',
         '    Источник = Excel.CurrentWorkbook(){[Name="Продажи"]}[Content],\r\n'
         '    Результат = Table.RowCount(Источник)'),
    ])
    return k.записать(os.path.join(каталог, 'pq.xlsx'))


def пара(каталог):
    """Две версии одной книги: лист переименован, имя убрано, формула
       изменена, лист добавлен. Для режима сравнения и различий на графе."""
    пути = []
    for версия in (1, 2):
        k = Книга('Отчёт квартальный v%d' % версия)
        заг = [k.строка(s) for s in ('Период', 'Доход', 'Расход', 'Прибыль')]
        строки = [(1, [ячейка('A1', строка_idx=заг[0]), ячейка('B1', строка_idx=заг[1]),
                       ячейка('C1', строка_idx=заг[2]), ячейка('D1', строка_idx=заг[3])])]
        for н in range(2, 10):
            # во второй версии прибыль считается с поправкой — формула другая
            ф = 'B%d-C%d' % (н, н) if версия == 1 else 'B%d-C%d*1.2' % (н, н)
            строки.append((н, [
                ячейка('A%d' % н, строка_idx=k.строка('Период %d' % (н - 1))),
                ячейка('B%d' % н, знач=н * 500),
                ячейка('C%d' % н, знач=н * 200),
                ячейка('D%d' % н, формула=ф),
            ]))
        k.лист('Данные', строки, размеры='A1:D9')
        # лист переименован между версиями
        k.лист('Свод 2025' if версия == 1 else 'Свод 2026',
               [(1, [ячейка('A1', формула='SUM(Данные!D2:D9)')])], размеры='A1:A1')
        if версия == 2:
            k.лист('Прогноз', [(1, [ячейка('A1', формула="'Свод 2026'!A1*1.1")])], размеры='A1:A1')
        k.имена.append(('Прибыль_итого', "'Свод %d'!$A$1" % (2025 + версия - 1), False, None))
        if версия == 1:
            k.имена.append(('Админ_расход', 'Данные!$C$2', False, None))
        for i in range(1, 6):
            k.имена.append(('BLPH%d' % i, 'Данные!$A$%d' % i, True, None))
        пути.append(k.записать(os.path.join(каталог, 'v%d.xlsx' % версия)))
    return пути

# Потолок разбора в REX — 40 МБ распакованного XML листа. Чтобы проверка
# упиралась именно в него, лист надо сделать заведомо больше. Порог берём
# с запасом: ровно на границе проверка станет хрупкой от любой правки
# разметки ячейки.
ПОТОЛОК = 40 * 1024 * 1024


def громоздкая(каталог):
    """Книга с листом, который REX по ячейкам не разбирает: он больше
       потолка. Нужна ровно для одного — убедиться, что REX про это
       говорит, а не выдаёт «ошибок 0» и молчит. Ошибки в листе есть, и
       много: если они доедут до отчёта, значит потолок не сработал."""
    k = Книга('Выгрузка из учётной системы')
    заг = k.строка('Код')
    k.лист('Свод', [(1, [ячейка('A1', строка_idx=k.строка('Итого')),
                         ячейка('B1', формула='SUM(Журнал!B:B)')])], размеры='A1:B1')

    # Собираем сразу строками XML, а не через ячейка(): сорок мегабайт
    # через список объектов Python собираются минуту и съедают гигабайт.
    куски, объём, н = [], 0, 1
    while объём < ПОТОЛОК + 2 * 1024 * 1024:
        строка = ('<row r="%d">'
                  '<c r="A%d" t="s"><v>%d</v></c>'
                  '<c r="B%d"><v>%d</v></c>'
                  '<c r="C%d"><f>B%d*Свод!$B$1</f><v>0</v></c>'
                  '<c r="D%d" t="e"><f>#REF!+B%d</f><v>#REF!</v></c>'
                  '</row>') % (н, н, заг, н, н * 7, н, н, н, н)
        куски.append(строка)
        объём += len(строка)
        н += 1
    тело = ''.join(куски)
    xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
           '<dimension ref="A1:D%d"/><sheetData>%s</sheetData></worksheet>' % (н - 1, тело))
    k.листы.append(('Журнал', xml, 'visible'))
    k.ошибок_в_журнале = н - 1
    return k.записать(os.path.join(каталог, 'huge.xlsx'))

def выгрузка_1с(каталог):
    """Книга в том виде, в каком её пишет выгрузка из 1С: весь диапазон
       отчёта размечен, и каждой пустой клетке поставлен тип «ошибка»
       (t="e") без значения. Excel рисует такие ячейки пустыми — значения
       нет, показывать нечего, — а читатель, смотрящий на тип, видит
       тысячи ошибок на ровном месте. Заодно здесь есть одна настоящая
       ошибка со значением: правило обязано отличать одно от другого."""
    k = Книга('Бухгалтерский баланс')
    строки = []
    # шапка: текст в B, дальше пустые клетки объединённого заголовка
    строки.append((1, ['<c r="B1" s="1" t="s"><v>%d</v></c>' % k.строка('Бухгалтерский баланс')]
                     + ['<c r="%s1" s="1" t="e"/>' % c for c in 'CDEFGH']))
    for н in range(2, 12):
        ряд = [ячейка('B%d' % н, строка_idx=k.строка('Статья %d' % (н - 1))),
               ячейка('C%d' % н, знач=н * 1000)]
        # D…H — размеченные, но пустые: ровно то, что делает 1С
        ряд += ['<c r="%s%d" s="2" t="e"/>' % (c, н) for c in 'DEFGH']
        строки.append((н, ряд))
    # настоящая ошибка: тип «ошибка» И значение
    строки.append((12, [ячейка('B12', формула='C2/0', ошибка='#DIV/0!')]))
    k.лист('Баланс', строки, размеры='A1:H12')
    return k.записать(os.path.join(каталог, '1c.xlsx'))


if __name__ == '__main__':
    каталог = sys.argv[1] if len(sys.argv) > 1 else ЗДЕСЬ
    os.makedirs(каталог, exist_ok=True)
    собрано = ([ровная(каталог), запущенная(каталог), с_запросами(каталог)]
               + пара(каталог) + [громоздкая(каталог), выгрузка_1с(каталог)])
    for п in собрано:
        print('  %-14s %7d байт' % (os.path.basename(п), os.path.getsize(п)))
