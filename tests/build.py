#!/usr/bin/env python3
"""Сборка локальной копии приложения для проверок.

REX грузит библиотеки с jsDelivr. В проверках выходить в сеть нельзя:
прогон становится зависимым от чужого сервиса и от того, пустили ли
наружу вообще. Поэтому ссылки на CDN переписываются на tests/vendor.

Подменяем не вслепую: у каждой библиотеки в разметке стоит integrity, и
локальный файл обязан дать ту же сумму sha384. Не совпало — сборка
падает, а не подсовывает проверкам другой код.

    python3 build.py              # возьмёт самый свежий REX_v*.html
    python3 build.py ../REX_v2.4.4.html
"""
import base64
import glob
import hashlib
import os
import re
import sys

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
КОРЕНЬ = os.path.dirname(ЗДЕСЬ)
VENDOR = os.path.join(ЗДЕСЬ, 'vendor')
СБОРКА = os.path.join(ЗДЕСЬ, 'build')

# что на какой файл меняем: кусок URL → имя в vendor
ПОДМЕНЫ = [
    ('fflate@',          'fflate.js'),
    ('dagre@0',          'dagre.min.js'),
    ('cytoscape@',       'cytoscape.min.js'),
    ('cytoscape-dagre@', 'cytoscape-dagre.js'),
    ('xlsx@',            'xlsx.full.min.js'),
]


def версия_приложения():
    файлы = sorted(glob.glob(os.path.join(КОРЕНЬ, 'REX_v*.html')))
    if not файлы:
        sys.exit('Не найден REX_v*.html в ' + КОРЕНЬ)
    # имена версионные, лексикографической сортировки хватает до v9.9.9
    return файлы[-1]


def sha384(путь):
    with open(путь, 'rb') as f:
        return 'sha384-' + base64.b64encode(hashlib.sha384(f.read()).digest()).decode()


def собрать(исходник=None):
    исходник = исходник or версия_приложения()
    s = open(исходник, encoding='utf-8').read()

    отсутствуют = [ф for _, ф in ПОДМЕНЫ if not os.path.exists(os.path.join(VENDOR, ф))]
    if отсутствуют:
        sys.exit('Нет библиотек в tests/vendor: %s\nЗапустите: npm install && node tests/vendor.js'
                 % ', '.join(отсутствуют))

    # сверяем локальные копии с integrity из разметки
    объявлено = dict(re.findall(
        r'src="https://cdn\.jsdelivr\.net/npm/([^"]+)"\s+integrity="([^"]+)"', s))
    for кусок, файл in ПОДМЕНЫ:
        путь = os.path.join(VENDOR, файл)
        своя = sha384(путь)
        чужая = next((v for k, v in объявлено.items() if кусок in k), None)
        if чужая and своя != чужая:
            sys.exit('%s не совпадает с integrity в разметке:\n  в файле:   %s\n  объявлено: %s'
                     % (файл, своя, чужая))

    заменено = 0
    for кусок, файл in ПОДМЕНЫ:
        новый, n = re.subn(r'https://cdn\.jsdelivr\.net/npm/[^"\']*' + re.escape(кусок) + r'[^"\']*',
                           'vendor/' + файл, s)
        s, заменено = новый, заменено + n
    # integrity снимаем: он считался для адреса на CDN, а файл теперь рядом
    s = re.sub(r'\s+integrity="sha384-[^"]+"', '', s)
    s = re.sub(r'\s+crossorigin="anonymous"', '', s)

    os.makedirs(СБОРКА, exist_ok=True)
    цель = os.path.join(СБОРКА, 'app.html')
    open(цель, 'w', encoding='utf-8').write(s)
    # библиотеки должны лежать рядом со сборкой: vendor/ ссылается относительно
    связь = os.path.join(СБОРКА, 'vendor')
    if not os.path.exists(связь):
        os.symlink(VENDOR, связь)
    return цель, os.path.basename(исходник), заменено


if __name__ == '__main__':
    цель, имя, n = собрать(sys.argv[1] if len(sys.argv) > 1 else None)
    print('собрано из %s: %s (подменено ссылок: %d)' % (имя, os.path.relpath(цель, КОРЕНЬ), n))
