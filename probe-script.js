function probeList() {
  const noteButtons = document.querySelectorAll('[aria-label="Add note"]');
  console.log('Found rows:', noteButtons.length);

  const results = Array.from(noteButtons).map((noteButton, index) => {
    const button = noteButton.parentElement.parentElement.previousSibling;
    if (!button) {
      return { index, name: null, rawCategory: null, isPermanentlyClosed: false, isTemporarilyClosed: false, isBroken: false };
    }

    const nameElement = button.querySelector('.fontHeadlineSmall');
    const categorySpan = button.querySelector('.fontBodyMedium > div:last-child > div:last-child span:last-child');
    const rawCategory = categorySpan ? categorySpan.textContent.trim() : null;
    const lowerCategory = (rawCategory || '').toLowerCase();

    const isBroken = Array.from(button.querySelectorAll('img'))
      .some(img => img.src === 'https://maps.gstatic.com/tactile/pane/result-no-thumbnail-2x.png');

    return {
      index,
      name: nameElement ? nameElement.textContent : null,
      rawCategory,
      isPermanentlyClosed: lowerCategory.includes('permanently closed'),
      isTemporarilyClosed: lowerCategory.includes('temporarily closed'),
      isBroken,
    };
  });

  console.table(results);
  return results;
}

probeList();
