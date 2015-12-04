/*
 * Copyright 2015 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var gw = require('jupyter-js-services');
var RDD = require('./RDD.js');
var protocol = require('./kernel.js');
var Utils = require('./utils.js');
var request = require('request');

function _getURL() {

  // special processing for eclairjs.cloudet.xyz to follow redirect
  //  to spawned kernel

  var JUPYTER_HOST = process.env.JUPYTER_HOST || "127.0.0.1";
  var JUPYTER_PORT = process.env.JUPYTER_PORT || 8888;

  // used for remote urls where we need to handle redirects
  var ELAIRJS_HOST = process.env.ECLAIRJS_HOST || "";

  return new Promise(function(resolve, reject) {
    if (JUPYTER_HOST != ELAIRJS_HOST) {
      resolve(JUPYTER_HOST + ":" + JUPYTER_PORT);
    } else {
      request({
        followAllRedirects: true,
        url: "http://" + ELAIRJS_HOST + "/spawn"
      }, function(error, response, body) {
        if (!error) {
          // console.log(response.request.path);
          var userPath = response.request.path.split('/').slice(0, 3).join('/');
          var hostURL = ELAIRJS_HOST + userPath;
          // console.log(hostURL)
          resolve(hostURL);
        }
        else
          reject(error);
      });
    }
  });
}

/**
 *
 * @constructor
 * @classdesc A JavaScript-friendly version of SparkContext that returns RDDs
 * Only one SparkContext may be active per JVM. You must stop() the active SparkContext before creating a new one.
 * This limitation may eventually be removed; see SPARK-2243 for more details.
 * @param {string} master - Cluster URL to connect to
 * @param {string} name - A name for your application, to display on the cluster web UI
 */
function SparkContext(master, name) {
  this.kernel = new Promise(function(resolve, reject) {

    _getURL().then(function(hostURL){
      //start the kernel
      gw.startNewKernel({
        baseUrl: "http://" + hostURL,
        wsUrl: "ws://" + hostURL,
        name: "eclair"
      }).then(function(k) {
        console.log("got kernel");
        //when we have kernel info we know the spark kernel is ready.
        k.kernelInfo().then(function(info) {
          var templateStr = 
              'var jsc = new SparkContext("{{master}}", "{{name}}");'
          var code = Utils.processTemplate(templateStr, 
                                           {master: master, name: name})
          k.execute({
            code: code
          }).handleMsg = msg => {
            if(msg.msg_type === 'status' &&
               msg.content.execution_state === 'idle') {
              resolve(k);
            }
          }
        });
      });

    }).catch(function(err) {
      reject(err);
    })
  })
}

/**
 * Distribute a local Scala collection to form an RDD.
 * @param {array} arr
 * @returns {RDD}
 */
SparkContext.prototype.parallelize = function(arr) {
  var refId = kernel.genVariable();
  var self = this;
  return new RDD(this.kernel, new Promise(function(resolve, reject) {
    self.kernel.then(kernel => {
      var templateStr = 'var {{refId}} = jsc.parallelize("{{arr}}");';
      var code = Utils.processTemplate(templateStr, {refId: refId, arr: arr.join(",")});

      protocol.verifyAssign(kernel.execute({code: code }),
                            resolve,
                            reject,
                            refId);
    })
  }))
}

/**
 * Read a text file from HDFS, a local file system (available on all nodes), or any Hadoop-supported file system URI,
 * and return it as an RDD of Strings.
 * @param {string} path - path to file
 * @returns {RDD}
 */
SparkContext.prototype.textFile = function(path) {
  var refId = protocol.genVariable('rdd');
  var self = this;
  return new RDD(this.kernel, new Promise(function(resolve, reject) {
    self.kernel.then(kernel => {
      var templateStr = 'var {{refId}} = jsc.textFile("{{path}}");';
      var code = Utils.processTemplate(templateStr, {refId: refId, path: path});

      protocol.verifyAssign(kernel.execute({code: code, silent: false}),
                            resolve,
                            reject,
                            refId);
    })
  }))
}

module.exports = SparkContext;


