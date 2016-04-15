#!/usr/bin/env node

'use strict';

let path = require('path');

let args = process.argv.slice(2);

let config = require(path.join(process.cwd(), args[0])).config;

if (config.snappit === undefined) {
    throw new Error(
`
You must set up your snappit configuration settings in your protractor configuration file.
Add a new entry to the configuration file titled "snappit" to get started.
`
    );
}

if (config.snappit.cloneUrl === undefined) {
    throw new Error(
`
Your protractor config file is missing a snappit.cloneUrl entry.
`
    );
}
