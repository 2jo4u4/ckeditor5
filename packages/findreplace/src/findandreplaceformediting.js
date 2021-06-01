import Plugin from "@ckeditor/ckeditor5-core/src/plugin";
import Collection from "@ckeditor/ckeditor5-utils/src/collection";
import uid from "@ckeditor/ckeditor5-utils/src/uid";

const HIGHLIGHT_CLASS = "find-result_selected";

/**
 * Returns text representation of a range. The returned text length should be the same as range length.
 * In order to achieve this this function will:
 * - replace inline elements (text-line) as new line character ("\n").
 * - @todo: check unicode characters
 */
export function rangeToText(range) {
  return Array.from(range.getItems()).reduce((rangeText, node) => {
    // Trim text to a last occurrence of an inline element and update range start.
    if (!(node.is("text") || node.is("textProxy"))) {
      // Editor has only one inline element defined in schema: `<softBreak>` which is treated as new line character in blocks.
      // Special handling might be needed for other inline elements (inline widgets).
      return `${rangeText}\n`;
    }

    return rangeText + node.data;
  }, "");
}

function findInsertIndex(resultsList, markerToInsert) {
  const result = resultsList.find(({ marker }) => {
    return markerToInsert.getStart().isBefore(marker.getStart());
  });

  return result ? resultsList.getIndex(result) : resultsList.length;
}

/**
 * Executes findCallback and updates search results list.
 */
function updateFindResultFromRange(range, model, findCallback, results) {
  [...range].forEach(({ type, item }) => {
    if (type === "elementStart") {
      if (model.schema.checkChild(item, "$text")) {
        const foundItems = findCallback({
          item,
          text: rangeToText(model.createRangeIn(item)),
        });

        if (!foundItems) {
          return;
        }

        foundItems.forEach((foundItem) => {
          model.change((writer) => {
            const resultId = `findResult:${uid()}`;
            const marker = writer.addMarker(resultId, {
              usingOperation: false,
              affectsData: false,
              range: writer.createRange(
                writer.createPositionAt(item, foundItem.start),
                writer.createPositionAt(item, foundItem.end)
              ),
            });

            const index = findInsertIndex(results, marker);

            results.add(
              {
                id: resultId,
                label: foundItem.label,
                marker,
              },
              index
            );
          });
        });
      }
    }
  });
}

function regexpMatchToFindResult(matchResult) {
  return {
    label: matchResult[0],
    start: matchResult.index,
    end: matchResult.index + matchResult[0].length,
  };
}

function findByTextCallback(searchTerm) {
  const regExp = new RegExp(`${searchTerm}`, "igu");

  function findCallback({ text }) {
    const matches = [...text.matchAll(regExp)];

    return matches.map(regexpMatchToFindResult);
  }

  return findCallback;
}

// Reacts to document changes in order to update search list.
function onDocumentChange(results, model, searchCallback) {
  const changedNodes = new Set();
  const removedMarkers = new Set();

  const changes = model.document.differ.getChanges();

  // Get nodes in which changes happened to re-run a search callback on them.
  changes.forEach((change) => {
    if (change.name === "$text" || model.schema.isInline(change.position.nodeAfter)) {
      changedNodes.add(change.position.parent);

      [...model.markers.getMarkersAtPosition(change.position)].forEach((markerAtChange) => {
        removedMarkers.add(markerAtChange.name);
      });
    } else if (change.type === "insert") {
      changedNodes.add(change.position.nodeAfter);
    }
  });

  // Get markers from removed nodes also.
  model.document.differ.getChangedMarkers().forEach(({ name, data: { newRange } }) => {
    if (newRange.start.root.rootName === "$graveyard") {
      removedMarkers.add(name);
    }
  });

  // Get markers from updated nodes and remove all (search will be re-run on those nodes).
  changedNodes.forEach((node) => {
    const markersInNode = [...model.markers.getMarkersIntersectingRange(model.createRangeIn(node))];

    markersInNode.forEach((marker) => removedMarkers.add(marker.name));
  });

  // Remove results & markers from changed part of content.
  model.change((writer) => {
    removedMarkers.forEach((markerName) => {
      // Remove result first - in order to prevent rendering removed marker.
      results.remove(markerName);
      writer.removeMarker(markerName);
    });
  });

  // Run search callback again on updated nodes.
  changedNodes.forEach((nodeToCheck) => {
    updateFindResultFromRange(model.createRangeOn(nodeToCheck), model, searchCallback, results);
  });
}

function getDefaultCallback(textOrCallback) {
  return (writer) => {
    return writer.createText(textOrCallback);
  };
}

function isPositionInRangeBoundaries(range, position) {
  return range.containsPosition(position) || range.end.isEqual(position) || range.start.isEqual(position);
}

function setupSelectedResultHighlighting(editor) {
  const { view } = editor.editing;
  const { model } = editor;
  const highlightedMarkers = new Set();

  const getMarkerAtPosition = (position) =>
    [...editor.model.markers].find((marker) => {
      return isPositionInRangeBoundaries(marker.getRange(), position) && marker.name.startsWith("findResult:");
    });

  view.document.registerPostFixer((writer) => {
    const modelSelection = model.document.selection;

    const marker = getMarkerAtPosition(modelSelection.focus);

    if (!marker) {
      return;
    }

    [...editor.editing.mapper.markerNameToElements(marker.name)].forEach((viewElement) => {
      writer.addClass(HIGHLIGHT_CLASS, viewElement);
      highlightedMarkers.add(viewElement);
    });
  });

  function removeHighlight() {
    view.change((writer) => {
      [...highlightedMarkers.values()].forEach((item) => {
        writer.removeClass(HIGHLIGHT_CLASS, item);
        highlightedMarkers.delete(item);
      });
    });
  }

  // Removing the class.
  editor.conversion.for("editingDowncast").add((dispatcher) => {
    // Make sure the highlight is removed on every possible event, before conversion is started.
    dispatcher.on("insert", removeHighlight, { priority: "highest" });
    dispatcher.on("remove", removeHighlight, { priority: "highest" });
    dispatcher.on("attribute", removeHighlight, { priority: "highest" });
    dispatcher.on("selection", removeHighlight, { priority: "highest" });
  });
}

/**
 * Editor plugin that provides Find & Replace API.
 *
 * This plugin:
 * - Exposes `find( callback )` API that initiates search.
 * - Renders search result markers in the editing area.
 * - Updates list of found results on document changes.
 */
export default class FindAndReplaceFormEditing extends Plugin {
  static get pluginName() {
    return "FindAndReplaceForm";
  }

  init() {
    // Setup marker highlighting conversion.
    this.editor.conversion.for("editingDowncast").markerToHighlight({
      model: "findResult",
      view: ({ markerName }) => {
        const [, id] = markerName.split(":");

        // Marker removal from the view has a bug: https://github.com/ckeditor/ckeditor5/issues/7499
        // A minimal option is to return a new object for each converted marker...
        return {
          name: "span",
          classes: ["find-result"],
          attributes: {
            // ...however, adding a unique attribute should be future-proof..
            "data-find-result": id,
          },
        };
      },
    });

    setupSelectedResultHighlighting(this.editor);

    this.activeResults = null;
  }

  /**
   * Initiate a search.
   *
   * @param {Function|String} callbackOrText
   */
  find(callbackOrText) {
    const { editor } = this;
    const { model } = editor;

    let findCallback;

    // Allow to execute `find()` on a plugin with a keyword only.
    if (typeof callbackOrText === "string") {
      findCallback = findByTextCallback(callbackOrText);
    } else {
      findCallback = callbackOrText;
    }

    const results = new Collection();

    // Initial search is done on all nodes inside content.
    const range = model.createRangeIn(model.document.getRoot());

    updateFindResultFromRange(range, model, findCallback, results);

    this.listenTo(model.document, "change:data", () => onDocumentChange(results, model, findCallback));

    this.activeResults = results;

    return this.activeResults;
  }

  /**
   * Stops active results from updating.
   */
  stop() {
    if (!this.activeResults) {
      return;
    }

    this.stopListening(this.editor.model.document);

    // Remove all markers from the editor.
    this.editor.model.change((writer) => {
      [...this.activeResults].forEach(({ marker }) => {
        writer.removeMarker(marker);
      });
    });

    this.activeResults = null;
  }

  /**
   * Replace given find result by a string or a callback.
   *
   * @param result
   * @param {String|Function} textOrCallback
   */
  replace({ marker }, textOrCallback) {
    const { model } = this.editor;

    const callback = typeof textOrCallback === "function" ? textOrCallback : getDefaultCallback(textOrCallback);

    model.change((writer) => {
      const range = marker.getRange();

      model.insertContent(callback(writer), range);
    });
  }

  /**
   * Replace all find results by a string or a callback.
   *
   * @param {String|Function} textOrCallback
   */
  replaceAll(textOrCallback) {
    if (!this.activeResults) {
      return;
    }

    this.editor.model.change(() => {
      [...this.activeResults].forEach((replace) => {
        this.replace(replace, textOrCallback);
      });
    });
  }
}
