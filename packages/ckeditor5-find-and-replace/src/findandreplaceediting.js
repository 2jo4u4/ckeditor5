/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module find-and-replace/findandreplaceediting
 */

import { Plugin } from 'ckeditor5/src/core';
import { updateFindResultFromRange } from './utils';
import FindCommand from './findcommand';
import ReplaceCommand from './replacecommand';
import ReplaceAllCommand from './replaceallcommand';
import FindNextCommand from './findnextcommand';
import FindPreviousCommand from './findpreviouscommand';

import { ObservableMixin, mix, Collection } from 'ckeditor5/src/utils';

import '../theme/findandreplace.css';

/**
 * Object storing find & replace plugin state in a given editor instance.
 *
 */
class FindAndReplaceState {
	constructor() {
		this.set( 'results', new Collection() );

		this.set( 'highlightedResult', null );

		this.set( 'searchText', '' );

		this.set( 'replaceText', '' );

		this.set( 'matchCase', false );
		this.set( 'matchWholeWords', false );
	}

	clear( model ) {
		// @todo: actually this handling might be moved to editing part.
		// This could be a results#change listener that would ensure that related markers are ALWAYS removed without
		// having to call state.clear() explicitly.

		this.searchText = '';
		// this.replaceText = '';

		model.change( writer => {
			if ( this.highlightedResult ) {
				const oldMatchId = this.highlightedResult.marker.name.split( ':' )[ 1 ];
				const oldMarker = model.markers.get( `findResultHighlighted:${ oldMatchId }` );

				if ( oldMarker ) {
					writer.removeMarker( oldMarker );
				}
			}

			[ ...this.results ].forEach( ( { marker } ) => {
				writer.removeMarker( marker );
			} );
		} );

		this.results.clear();
	}
}

mix( FindAndReplaceState, ObservableMixin );

const HIGHLIGHT_CLASS = 'ck-find-result_selected';

// Reacts to document changes in order to update search list.
function onDocumentChange( results, model, searchCallback ) {
	const changedNodes = new Set();
	const removedMarkers = new Set();

	const changes = model.document.differ.getChanges();

	// Get nodes in which changes happened to re-run a search callback on them.
	changes.forEach( change => {
		if ( change.name === '$text' || model.schema.isInline( change.position.nodeAfter ) ) {
			changedNodes.add( change.position.parent );

			[ ...model.markers.getMarkersAtPosition( change.position ) ].forEach( markerAtChange => {
				removedMarkers.add( markerAtChange.name );
			} );
		} else if ( change.type === 'insert' ) {
			changedNodes.add( change.position.nodeAfter );
		}
	} );

	// Get markers from removed nodes also.
	model.document.differ.getChangedMarkers().forEach( ( { name, data: { newRange } } ) => {
		if ( newRange && newRange.start.root.rootName === '$graveyard' ) {
			removedMarkers.add( name );
		}
	} );

	// Get markers from updated nodes and remove all (search will be re-run on those nodes).
	changedNodes.forEach( node => {
		const markersInNode = [ ...model.markers.getMarkersIntersectingRange( model.createRangeIn( node ) ) ];

		markersInNode.forEach( marker => removedMarkers.add( marker.name ) );
	} );

	// Remove results & markers from changed part of content.
	model.change( writer => {
		removedMarkers.forEach( markerName => {
			// Remove result first - in order to prevent rendering removed marker.
			if ( results.has( markerName ) ) {
				results.remove( markerName );
			}

			writer.removeMarker( markerName );
		} );
	} );

	// Run search callback again on updated nodes.
	changedNodes.forEach( nodeToCheck => {
		updateFindResultFromRange( model.createRangeOn( nodeToCheck ), model, searchCallback, results );
	} );
}

function isPositionInRangeBoundaries( range, position ) {
	return range.containsPosition( position ) || range.end.isEqual( position ) || range.start.isEqual( position );
}

/**
 * Implements editing part for find and replace plugin. For example conversion, commands etc.
 *
 * @extends module:core/plugin~Plugin
 */
export default class FindAndReplaceEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'FindAndReplaceEditing';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		this.activeResults = null;
		this.state = new FindAndReplaceState();

		this._defineConverters();
		this._defineCommands();

		this.listenTo( this.state, 'change:highlightedResult', ( eventInfo, name, newValue, oldValue ) => {
			const { model } = this.editor;

			model.change( writer => {
				if ( oldValue ) {
					const oldMatchId = oldValue.marker.name.split( ':' )[ 1 ];
					const oldMarker = model.markers.get( `findResultHighlighted:${ oldMatchId }` );

					if ( oldMarker ) {
						writer.removeMarker( oldMarker );
					}
				}

				if ( newValue ) {
					const newMatchId = newValue.marker.name.split( ':' )[ 1 ];
					writer.addMarker( `findResultHighlighted:${ newMatchId }`, {
						usingOperation: false,
						affectsData: false,
						range: newValue.marker.getRange()
					} );
				}
			} );
		} );
	}

	/**
	 * Initiate a search.
	 *
	 * @param {Function|String} callbackOrText
	 * @returns {module:utils/collection~Collection}
	 */
	find( callbackOrText ) {
		const { editor } = this;
		const { model } = editor;

		const { findCallback, results } = editor.execute( 'find', callbackOrText );

		this.activeResults = results;

		// @todo: handle this listener, another copy is in findcommand.js file.
		this.listenTo( model.document, 'change:data', () => onDocumentChange( this.activeResults, model, findCallback ) );

		return this.activeResults;
	}

	/**
	 * Stops active results from updating, and clears out the results.
	 */
	stop() {
		if ( !this.activeResults ) {
			return;
		}

		this.stopListening( this.editor.model.document );

		this.state.clear( this.editor.model );

		this.activeResults = null;
	}

	/**
	 * @private
	 */
	_defineCommands() {
		this.editor.commands.add( 'find', new FindCommand( this.editor, this.state ) );
		this.editor.commands.add( 'findNext', new FindNextCommand( this.editor, this.state ) );
		this.editor.commands.add( 'findPrevious', new FindPreviousCommand( this.editor, this.state ) );
		this.editor.commands.add( 'replace', new ReplaceCommand( this.editor, this.state ) );
		this.editor.commands.add( 'replaceAll', new ReplaceAllCommand( this.editor, this.state ) );
	}

	/**
	 * @private
	 */
	_defineConverters() {
		const { editor } = this;
		const { view } = editor.editing;
		const { model } = editor;
		const highlightedMarkers = new Set();

		const getMarkerAtPosition = position =>
			[ ...editor.model.markers ].find( marker => {
				return isPositionInRangeBoundaries( marker.getRange(), position ) && marker.name.startsWith( 'findResult:' );
			} );

		view.document.registerPostFixer( writer => {
			const modelSelection = model.document.selection;

			const marker = getMarkerAtPosition( modelSelection.focus );

			if ( !marker ) {
				return;
			}

			[ ...editor.editing.mapper.markerNameToElements( marker.name ) ].forEach( viewElement => {
				writer.addClass( HIGHLIGHT_CLASS, viewElement );
				highlightedMarkers.add( viewElement );
			} );
		} );

		function removeHighlight() {
			view.change( writer => {
				[ ...highlightedMarkers.values() ].forEach( item => {
					writer.removeClass( HIGHLIGHT_CLASS, item );
					highlightedMarkers.delete( item );
				} );
			} );
		}

		// Removing the class.
		editor.conversion.for( 'editingDowncast' ).add( dispatcher => {
			// Make sure the highlight is removed on every possible event, before conversion is started.
			dispatcher.on( 'insert', removeHighlight, { priority: 'highest' } );
			dispatcher.on( 'remove', removeHighlight, { priority: 'highest' } );
			dispatcher.on( 'attribute', removeHighlight, { priority: 'highest' } );
			dispatcher.on( 'selection', removeHighlight, { priority: 'highest' } );
		} );

		// Setup marker highlighting conversion.
		this.editor.conversion.for( 'editingDowncast' ).markerToHighlight( {
			model: 'findResult',
			view: ( { markerName } ) => {
				const [ , id ] = markerName.split( ':' );

				// Marker removal from the view has a bug: https://github.com/ckeditor/ckeditor5/issues/7499
				// A minimal option is to return a new object for each converted marker...
				return {
					name: 'span',
					classes: [ 'ck-find-result' ],
					attributes: {
						// ...however, adding a unique attribute should be future-proof..
						'data-find-result': id
					}
				};
			}
		} );

		this.editor.conversion.for( 'editingDowncast' ).markerToHighlight( {
			model: 'findResultHighlighted',
			view: ( { markerName } ) => {
				const [ , id ] = markerName.split( ':' );

				// Marker removal from the view has a bug: https://github.com/ckeditor/ckeditor5/issues/7499
				// A minimal option is to return a new object for each converted marker...
				return {
					name: 'span',
					classes: [ HIGHLIGHT_CLASS ],
					attributes: {
						// ...however, adding a unique attribute should be future-proof..
						'data-find-result': id
					}
				};
			}
		} );
	}
}
