'use strict';

const { LoadReadOnlyUtils } = require('./util/ReadOnlyUtils');
const { LoadWriteOnlyUtils } = require('./util/WriteOnlyUtils');

exports.LoadUtils = () => {
    // Initialize the WWebJS namespace
    window.WWebJS = {};

    // Load read-only utility functions
    LoadReadOnlyUtils();

    // Load write-only utility functions (stubbed for read-only mode)
    LoadWriteOnlyUtils();
};