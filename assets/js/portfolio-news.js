(function () {
  const feed = document.querySelector("[data-news-feed]");
  const dialog = document.querySelector("[data-news-dialog]");
  if (!feed || !dialog || !Array.isArray(window.portfolioNews)) return;

  const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" });
  const shortDateFormat = new Intl.DateTimeFormat("pt-BR");
  const parsePublicationDate = (date) => new Date(`${date}T12:00:00`);
  const formatDate = (date) => dateFormat.format(parsePublicationDate(date));

  function textElement(tag, value, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function openNews(news) {
    const content = dialog.querySelector("[data-news-dialog-content]");
    content.replaceChildren();
    const gallery = document.createElement("div"); gallery.className = "news-dialog-gallery";
    const image = new Image(); image.alt = `Imagem da notícia: ${news.title}`;
    if (news.images.length === 1) {
      image.src = news.images[0];
      gallery.append(image);
    } else {
      let currentImage = 0;
      const frame = document.createElement("div"); frame.className = "news-carousel-frame";
      const previous = textElement("button", "‹", "news-carousel-control news-carousel-previous"); previous.type = "button"; previous.setAttribute("aria-label", "Imagem anterior");
      const next = textElement("button", "›", "news-carousel-control news-carousel-next"); next.type = "button"; next.setAttribute("aria-label", "Próxima imagem");
      const counter = textElement("span", "", "news-carousel-counter");
      const updateCarousel = () => { image.src = news.images[currentImage]; counter.textContent = `${currentImage + 1} / ${news.images.length}`; };
      previous.addEventListener("click", () => { currentImage = (currentImage - 1 + news.images.length) % news.images.length; updateCarousel(); });
      next.addEventListener("click", () => { currentImage = (currentImage + 1) % news.images.length; updateCarousel(); });
      updateCarousel(); frame.append(image, previous, next, counter); gallery.append(frame);
    }
    const header = document.createElement("header"); header.className = "news-dialog-header";
    const badge = textElement("span", news.category, "badge success");
    const author = textElement("p", `Por ${news.author}`, "news-dialog-author");
    const time = textElement("time", `${news.location || "Curitiba"} - ${shortDateFormat.format(parsePublicationDate(news.publishedOn))}`, "news-dialog-date"); time.dateTime = news.publishedOn;
    header.append(badge, textElement("h2", news.title), author, time);
    const copy = document.createElement("div"); copy.className = "news-dialog-copy";
    news.body.forEach((paragraph) => copy.append(textElement("p", paragraph)));
    const footer = document.createElement("footer"); footer.className = "news-dialog-footer";
    footer.append(textElement("p", `Por: ${news.author}`), textElement("p", `Créditos: ${news.credits}`));
    const link = document.createElement("a"); link.className = "btn"; link.href = news.link; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = news.linkLabel; footer.replaceChildren(link);
    content.append(gallery, header, copy, footer); dialog.showModal();
  }

  [...window.portfolioNews].sort((first, second) => second.publishedOn.localeCompare(first.publishedOn)).forEach((news, index) => {
    const card = document.createElement("article"); card.className = `news-card${index === 0 ? " news-card-featured" : ""}`;
    const image = new Image(); image.className = "news-card-image"; image.src = news.images[0]; image.alt = `Abrir notícia: ${news.title}`; image.loading = index < 2 ? "eager" : "lazy"; image.tabIndex = 0; image.setAttribute("role", "button");
    image.addEventListener("click", () => openNews(news));
    image.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNews(news); } });
    const content = document.createElement("div"); content.className = "news-card-content";
    const meta = document.createElement("div"); meta.className = "news-card-meta";
    const badge = textElement("span", news.category, "badge success");
    const time = textElement("time", formatDate(news.publishedOn)); time.dateTime = news.publishedOn; meta.append(badge, time);
    const read = textElement("button", "Ler notícia", "news-read-button"); read.type = "button"; read.addEventListener("click", () => openNews(news));
    const direct = document.createElement("a"); direct.className = "news-direct-link"; direct.href = news.link; direct.target = "_blank"; direct.rel = "noreferrer"; direct.textContent = news.linkLabel;
    const actions = document.createElement("div"); actions.className = "news-card-actions"; actions.append(read, direct);
    content.append(meta, textElement("h2", news.title), textElement("p", news.summary), actions); card.append(image, content); feed.append(card);
  });
  dialog.querySelector("[data-news-dialog-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}());
