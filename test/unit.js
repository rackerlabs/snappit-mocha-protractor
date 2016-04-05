'use strict';

let util = require('../lib/util');

describe('util functions', function () {

    describe('fileSystemFriendly', function () {
        it('should convert a string to a fs-friendly string', function () {
            let unfriendly = 'Contains spaces and (some!?.,+?<>:*|") special characters';
            let friendly = 'Contains-spaces-and-(some)-special-characters';
            expect(util.fileSystemFriendly(unfriendly)).to.equal(friendly);
        });
    });

    describe('buildFullNameFromParents', function () {
        it('should build the full file system friendly name from a test context', function () {
            let nameFromTestContext = util.buildFullNameFromParents(this.test);
            expect(nameFromTestContext).to.equal('util functions buildFullNameFromParents');
        });
    });

    describe('handleMochaHooks', function () {
        let beforeHookName;

        before(function () {
            beforeHookName = util.handleMochaHooks(this);
        });

        it('should have built the before hook name correctly', function () {
            let fullTitle = 'util functions handleMochaHooks-"before all" hook';
            expect(beforeHookName.file).to.match(/test\/unit.js$/);
            expect(beforeHookName.fullTitle).to.equal(fullTitle);
        });

        it('should build a normal test name correctly', function () {
            let normalTestName = util.handleMochaHooks(this);
            let fullTitle = 'util functions handleMochaHooks should build a normal test name correctly';
            expect(normalTestName.file).to.match(/test\/unit.js$/);
            expect(normalTestName.fullTitle).to.equal(fullTitle);
        });
    });

});
