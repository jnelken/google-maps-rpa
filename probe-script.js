function probeList() {
  const rows = document.querySelectorAll('.BsJqK');
  console.log('Found rows:', rows.length);

  const results = Array.from(rows).map((row, index) => {
    const nameElement = row.querySelector('.fontHeadlineSmall');
    const name = nameElement ? nameElement.textContent.trim() : null;

    // .yfRytc holds up to two .IIrLbb blocks: [0] = rating (if present), [1] = category.
    // When there's no rating, the single block is the category.
    const categoryBlocks = row.querySelectorAll('.yfRytc > .IIrLbb');
    let rawCategory = null;
    if (categoryBlocks.length >= 2) {
      rawCategory = categoryBlocks[1].textContent.trim();
    } else if (categoryBlocks.length === 1) {
      rawCategory = categoryBlocks[0].textContent.trim();
    }
    const lowerCategory = (rawCategory || '').toLowerCase();

    const isBroken = Array.from(row.querySelectorAll('img'))
      .some(img => (img.src || '').includes('result-no-thumbnail'));

    return {
      index,
      name,
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
