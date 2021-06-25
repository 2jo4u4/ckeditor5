/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

import ModelTestEditor from '@ckeditor/ckeditor5-core/tests/_utils/modeltesteditor';
import { setData, getData } from '@ckeditor/ckeditor5-engine/src/dev-utils/model';
import FindAndReplaceEditing from '../src/findandreplaceediting';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import BoldEditing from '@ckeditor/ckeditor5-basic-styles/src/bold/boldediting';

describe( 'ReplaceCommand', () => {
	let editor, model, command;

	beforeEach( () => {
		return ModelTestEditor
			.create( {
				plugins: [ FindAndReplaceEditing, Paragraph, BoldEditing ]
			} )
			.then( newEditor => {
				editor = newEditor;
				model = editor.model;
				command = editor.commands.get( 'replace' );
			} );
	} );

	afterEach( () => {
		return editor.destroy();
	} );

	describe( 'isEnabled', () => {
		it( 'should be enabled in empty document', () => {
			setData( model, '[]' );
			expect( command.isEnabled ).to.be.true;
		} );

		it( 'should be enabled by default', () => {
			expect( command.isEnabled ).to.be.true;
		} );

		it( 'should be enabled at the end of paragraph', () => {
			setData( model, '<paragraph>foo[]</paragraph>' );
			expect( command.isEnabled ).to.be.true;
		} );
	} );

	describe( 'state', () => {
		it( 'is set to plugin\'s state', () => {
			expect( command.state ).to.equal( editor.plugins.get( 'FindAndReplaceEditing' ).state );
		} );
	} );

	describe( 'execute()', () => {
		it( 'should replace single search result using text', () => {
			setData( model, '<paragraph>foo foo foo foo</paragraph>' );

			const range = editor.model.document.selection.getFirstRange();
			const markerId = 'my-marker-id';

			model.change( writer => {
				const marker = writer.addMarker( markerId, {
					usingOperation: false,
					affectsData: false,
					range
				} );

				editor.execute( 'replace', 'new', { marker } );
			} );

			expect( editor.getData() ).to.equal( '<p>Foo bar baz</p><p>Foo new baz</p>' );
		} );

		it( 'should highlight next match', () => {
			setData( model, '<paragraph>foo foo foo foo []</paragraph>' );

			const { results } = editor.execute( 'find', 'foo' );
			editor.execute( 'replace', 'bar', results.get( 0 ) );

			for ( let i = 0; i < results.length; i++ ) {
				const result = results.get( i );

				result.marker.name = `findResult:${ i }`;
			}

			for ( const marker of editor.model.markers ) {
				if ( marker.name.startsWith( 'findResultHighlighted:' ) ) {
					marker.name = 'findResultHighlighted:x';
				}
			}

			expect( getData( editor.model, { convertMarkers: true } ) ).to.equal(
				'<paragraph>bar <findResult:1:start></findResult:1:start>' +
					'<findResultHighlighted:x:start></findResultHighlighted:x:start>foo<findResult:1:end></findResult:1:end>' +
					'<findResultHighlighted:x:end></findResultHighlighted:x:end> ' +
					'<findResult:2:start>' +
						'</findResult:2:start>foo<findResult:2:end></findResult:2:end> ' +
						'<findResult:3:start></findResult:3:start>foo<findResult:3:end></findResult:3:end> ' +
				'</paragraph>'
			);
		} );
	} );
} );
