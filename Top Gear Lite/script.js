let container = document.querySelector('.container');
let data = [];
let lastQuery = '';

// Utility: escape texto para uso em regex
function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Realça as partes do texto que casam com o termo (wrap em <mark>)
function highlight(text, query) {
    if (!query) return text;
    try {
        const re = new RegExp('(' + escapeRegExp(query) + ')', 'ig');
        return String(text).replace(re, '<mark>$1</mark>');
    } catch (e) {
        return text;
    }
}

async function loadData() {
    if (data.length === 0) {
        const resultado = await fetch('data.json');
        data = await resultado.json();
    }
    return data;
}

async function iniciarPesquisa(queryParam) {
    const input = document.getElementById('busca') || document.querySelector('header input');
    const raw = typeof queryParam === 'string' ? queryParam : (input ? input.value : '');
    const query = raw.trim().toLowerCase();
    lastQuery = query;

    await loadData();

    let resultados = [];
    if (query === '') {
        resultados = data;
    } else {
        resultados = data.filter(item => {
            const carro = item.carro ? String(item.carro).toLowerCase() : '';
            const descr = item.descrição ? String(item.descrição).toLowerCase() : '';
            const ano = item.ano ? String(item.ano) : '';
            return (
                carro.includes(query) ||
                descr.includes(query) ||
                ano.includes(query)
            );
        });
    }

    renderizarCards(resultados, query);
}

function renderizarCards(dataArray, query) {
    container.innerHTML = '';

    if (!dataArray || dataArray.length === 0) {
        const msg = document.createElement('p');
        msg.textContent = 'Nenhum resultado encontrado.';
        container.appendChild(msg);
        return;
    }

    for (let item of dataArray) {
        const article = document.createElement('article');
        article.classList.add('card');

        const title = highlight(item.carro || '', query);
        const year = highlight(String(item.ano || ''), query);
        const desc = highlight(item.descrição || '', query);
        const link = item.link_reportagem || '#';

        // imagem será carregada assincronamente; colocamos placeholder inicial (SVG)
        const figure = document.createElement('figure');
        figure.classList.add('card-figure');

        const img = document.createElement('img');
        img.classList.add('card-image');
        img.alt = item.carro ? `${item.carro} — imagem` : 'Imagem do veículo';
        img.dataset.source = link; // para referência
        img.src = placeholderDataURL(item.carro || 'Veículo');
        // melhorar performance e estabilidade de layout
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 1200; // corresponde ao placeholder SVG default
        img.height = 600;

        // figcaption/atribuição para acessibilidade e referência da fonte
        const caption = document.createElement('figcaption');
        caption.classList.add('image-attribution');
        const captionId = 'cap-' + Math.random().toString(36).slice(2, 9);
        caption.id = captionId;
        let sourceName = 'Fonte';
        try {
            if (link && link !== '#') sourceName = new URL(link).hostname.replace(/^www\./, '');
        } catch (e) {
            sourceName = 'Fonte';
        }
        // usar escapeHtml para evitar injeções, e adicionar rel noopener
        caption.innerHTML = `Imagem: <a href="${link}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceName)}</a>`;
        // ligar imagem à legenda para leitores de ecrã
        img.setAttribute('aria-describedby', captionId);

        figure.appendChild(img);
        figure.appendChild(caption);

        article.appendChild(figure);
        const content = document.createElement('div');
        content.classList.add('card-content');
        content.innerHTML = `
        <h2>${title}</h2>
        <p>${year}</p>
        <p>${desc}</p>
        <a href="${link}" target="_blank">Leia mais</a>
        `;

        article.appendChild(content);

        container.appendChild(article);

        // se `imagem` estiver definido em data.json, usa como fonte direta (mais confiável)
        if (item.imagem) {
            img.src = item.imagem;
        } else {
            // inicia busca da imagem em background (não bloqueante)
            resolveImageForArticle(link, item.carro).then(url => {
                if (url) {
                    img.src = url;
                }
            }).catch(() => {
                // se erro, mantemos placeholder
            });
        }
    }
}

// simples cache para evitar múltiplos fetches do mesmo link
const imageCache = new Map();

// cria um placeholder SVG inline com o nome do carro (data URI)
function placeholderDataURL(text) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='600' viewBox='0 0 1200 600'><rect width='100%' height='100%' fill='%23252525'/><text x='50%' y='50%' font-family='Quicksand, Arial, sans-serif' font-size='36' fill='%23cccccc' dominant-baseline='middle' text-anchor='middle'>${escapeHtml(text)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tenta extrair a imagem principal da página do artigo.
// Estratégia: 1) verificar cache; 2) tentar fetch via AllOrigins proxy; 3) procurar meta og:image / twitter:image / primeira img relevante; 4) normalizar URL; 5) cache & retornar
async function resolveImageForArticle(articleUrl, fallbackQuery) {
    if (!articleUrl) return null;
    const cacheKey = articleUrl || (fallbackQuery ? `fallback:${fallbackQuery}` : 'none');
    if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

    // Usamos AllOrigins (https://api.allorigins.win/raw?url=...) como proxy público para evitar CORS — pode falhar.
    const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(articleUrl);
    try {
        const resp = await fetch(proxy);
        if (!resp.ok) throw new Error('Fetch failed');
        const text = await resp.text();

        // procura meta tags og:image ou twitter:image
        let match = text.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        if (!match) match = text.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        if (!match) match = text.match(/<meta[^>]+property=["']twitter:image:src["'][^>]*content=["']([^"']+)["'][^>]*>/i);

        let imageUrl = match ? match[1] : null;

        // se não encontrou meta, tenta buscar primeira imagem em figure ou article > img
        if (!imageUrl) {
            // procura <figure ...><img src="..."
            match = text.match(/<figure[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>/i);
            if (!match) {
                // procura qualquer <img ...> próxima ao conteúdo principal
                match = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
            }
            imageUrl = match ? match[1] : null;
        }

        if (imageUrl) {
            // converte URL relativa para absoluta
            try {
                imageUrl = new URL(imageUrl, articleUrl).href;
            } catch (e) {
                // keep as-is
            }
            imageCache.set(cacheKey, imageUrl);
            return imageUrl;
        }
    } catch (e) {
        // pode falhar por CORS, proxy down, etc.
    }

    // Se falhou em extrair, usa fallback: Unsplash (query pelo nome do carro)
    if (fallbackQuery) {
        const unsplashUrl = `https://source.unsplash.com/1200x600/?${encodeURIComponent(fallbackQuery + ',car')}`;
        imageCache.set(cacheKey, unsplashUrl);
        return unsplashUrl;
    }

    // fallback final: null
    imageCache.set(cacheKey, null);
    return null;
}

// Debounce helper
function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Wire up events
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('busca') || document.querySelector('header input');
    const btn = document.getElementById('botao-busca');

    if (input) {
        // busca ao digitar com debounce
        input.addEventListener('input', debounce(() => iniciarPesquisa(), 300));
    }

    if (btn) {
        // ainda permite buscar via botão
        btn.addEventListener('click', () => iniciarPesquisa());
    }

    // mostra todos por padrão
    iniciarPesquisa('');
});