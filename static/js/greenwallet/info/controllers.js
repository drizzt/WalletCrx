angular.module('greenWalletInfoControllers',
    ['greenWalletServices'])
.controller('InfoController', ['$scope', 'wallets', 'tx_sender', '$modal', '$q', 'notices', '$location', 'gaEvent', 'cordovaReady', '$timeout',
        function InfoController($scope, wallets, tx_sender, $modal, $q, notices, $location, gaEvent, cordovaReady, $timeout) {
    if(!wallets.requireWallet($scope)) return;

    $scope.search = {query: null, today: new Date().toISOString(),
        open_picker: function($event, name) {
            $event.preventDefault();
            $event.stopPropagation();
            this['is_open_'+name] = !this['is_open_'+name];
        }};

    $scope.wallet.hidden = false;
    if ($scope.wallet.signup || ($scope.signup && $scope.signup.seed)) {
        gaEvent('Signup', 'OpenedWallet');
        if ($scope.signup) {
            $scope.signup.seed = undefined;
        }
        $scope.wallet.signup = false;
    }

    $scope.wallet.has_graph = true;  // element needs to be initially visible to allow computing width
    var update_graph = function() {
        tx_sender.call("http://greenaddressit.com/txs/get_daily_balance_chart", $scope.wallet.current_subaccount).then(function(balances_arr) {
            if (!document.getElementById('btc_graph')) {
                // not in 'Transactions' tab anymore - don't do anything to avoid breaking it
                return;
            }
            var btcGraph = dc.lineChart("#btc_graph");
            var prevDate;
            var balance = parseInt($scope.wallet.final_balance);
            var bMin = balance, bMax = balance;
            if (balances_arr.length < 2) {
                balances_arr = [{date: new Date(), balance: 0}];
                $scope.wallet.has_graph = false;
                gaEvent('Wallet', 'NotEnoughTxForBalanceGraph');
            } else {
                $scope.wallet.has_graph = true;
            }
            for (var i = 0; i < balances_arr.length; i++) {
                var balance = balances_arr[i][1];
                balances_arr[i]= {date: new Date(balances_arr[i][0]),
                                  balance: balance};
                bMin = Math.min(bMin, balance); bMax = Math.max(bMax, balance);
            }
            var balances = crossfilter(balances_arr);
            var byDate = balances.dimension(function(d) {return d.date} );
            var getSize = function() {
                var parent = document.getElementById('btc_graph').parentNode;
                return [Math.round(parent.offsetWidth), Math.round(parent.offsetWidth * (290/920))];
            };
            var size = getSize();
            var pow = {'BTC': 8, 'mBTC': 5, 'µBTC': 2, 'bits': 2}[$scope.wallet.unit];
            bMin /= Math.pow(10, pow); bMax /= Math.pow(10, pow);
            var dScale = (bMax - bMin) * 0.1;
            btcGraph.width(size[0]).height(size[1])
                .colors(['#69b16e'])
                .margins({top: 10, right: 50, bottom: 30, left: 60})
                .dimension(byDate)
                .valueAccessor(function (p) {
                    return p.value / Math.pow(10, pow);
                })
                .group(byDate.group().reduceSum(function(p) { return p.balance; }))
                .x(d3.time.scale().domain([balances_arr[0].date, balances_arr[balances_arr.length-1].date]))
                .y(d3.scale.linear().domain([Math.max(0, bMin-dScale), bMax+dScale]))
                .brushOn(false)
                .renderlet(
                    function(chart) {
                        chart.select("svg").attr("viewBox",
                                "0 0 " + size[0] + " " + size[1]).attr("preserveAspectRatio", "xMidYMid")
                        if (!$scope.wallet.has_graph) {
                            var text = chart.select("svg").selectAll("text").data(['empty']).enter().append("text");
                            text.attr("x", size[0]/2)
                                .attr("y", size[1]/2)
                                .attr("text-anchor", "middle")
                                .text(gettext("Not enough data to draw the graph"));
                        }
                    });
            btcGraph.xAxis().ticks(Math.floor(size[0]/100));
            btcGraph.yAxis().ticks(Math.floor(size[1]/30));
            dc.renderAll();
            angular.element(window).on('resize', function() {
                try {
                    var size = getSize();
                    var svg = document.getElementById('btc_graph').getElementsByTagName('svg')[0];
                    svg.setAttribute("width", size[0]);
                    svg.setAttribute("height", size[1]);
                } catch (err) {
                    //  btc_graph does not exist, i.e. logged out
                    //  FIXME: perhaps remove hooks on logout?
                }
            });
            gaEvent('Wallet', 'BalanceGraphShown');
        });
    }

    $scope.$watch('filtered_transactions', function(newValue, oldValue) {
        if (newValue && newValue.populate_csv) newValue.populate_csv();
    });

    var updating_timeout;
    var update_txs = function(timeout_ms, check_sorting) {
        if (updating_timeout) $timeout.cancel(updating_timeout);
        updating_timeout = $timeout(function() {
            $scope.filtered_transactions = [];
            $scope.loading_txs = true;
            updating_timeout = null;
            wallets.getTransactions($scope, null, $scope.search.query, $scope.sorting,
                    [$scope.search.date_start, $scope.search.date_end], $scope.wallet.current_subaccount).then(function(txs) {
                $scope.loading_txs = false;
                $scope.filtered_transactions = txs;
                if (check_sorting && ($scope.filtered_transactions.sorting.order_by != 'ts' ||
                                      !$scope.filtered_transactions.sorting.reversed)) {
                    $scope.filtered_transactions.pending_from_notification = true;
                }
                txs.populate_csv();
            });
        }, timeout_ms||0);
    };
    $scope.sorting = {};
    update_txs();
    update_graph();
    $scope.$watch('search.query', function(newValue, oldValue) {
        if (newValue !== oldValue) update_txs(800);
    });
    $scope.$watch('search.date_start', function(newValue, oldValue) {
        if (newValue !== oldValue) update_txs();
    });
    $scope.$watch('search.date_end', function(newValue, oldValue) {
        if (newValue !== oldValue) update_txs();
    });
    $scope.$watch('wallet.current_subaccount', function(newValue, oldValue) {
        if (newValue !== oldValue && newValue !== undefined) {
            update_txs();
            update_graph();
        }
    });
    $scope.$on('transaction', function(event, data) {
        if (data.subaccounts.indexOf($scope.wallet.current_subaccount) != -1) {
            update_txs(0, true);
            update_graph();
        }
    });
    $scope.$on('block', function(event, data) {
        if (!$scope.filtered_transactions || !$scope.filtered_transactions.list || !$scope.filtered_transactions.list.length) return;
        $scope.$apply(function() {
            for (var i = 0; i < $scope.filtered_transactions.list.length; i++) {
                if (!$scope.filtered_transactions.list[i].block_height) {
                    // if any unconfirmed, we need to refetch all txs to get the block height
                    if ($scope.filtered_transactions.sorting.order_by != 'ts' ||
                            !$scope.filtered_transactions.sorting.reversed) {
                        $scope.filtered_transactions.pending_conf_from_notification = true;
                    } else {
                        update_txs();
                        break;
                    }
                } else {
                    $scope.filtered_transactions.list[i].confirmations = data.count - $scope.filtered_transactions.list[i].block_height + 1;
                }
            }
        });
    });

    var redeem = function(encrypted_key, password) {
        var deferred = $q.defer()
        var errors = {
            invalid_privkey: gettext('Not a valid encrypted private key'),
            invalid_unenc_privkey: gettext('Not a valid private key'),
            invalid_passphrase: gettext('Invalid passphrase')
        }
        var sweep = function(key_bytes) {
            var key = new Bitcoin.ECKey(key_bytes, true);
            tx_sender.call("http://greenaddressit.com/vault/prepare_sweep_social", key.getPub().toBytes()).then(function(data) {
                data.prev_outputs = [];
                for (var i = 0; i < data.prevout_scripts.length; i++) {
                    data.prev_outputs.push(
                        {privkey: key, script: data.prevout_scripts[i]})
                }
                // TODO: verify
                wallets.sign_and_send_tx($scope, data, false, null, gettext('Funds redeemed'));
            }, function(error) {
                if (error.uri == 'http://greenaddressit.com/error#notenoughmoney') {
                    notices.makeNotice('error', gettext('Already redeemed'));
                } else {
                    notices.makeNotice('error', error.desc);
                }
            });
        };
        if (encrypted_key.indexOf('K') == 0 || encrypted_key.indexOf('L') == 0 || encrypted_key.indexOf('c') == 0) {  // unencrypted
            var bytes = Bitcoin.base58.decode(encrypted_key);
            if (bytes.length != 38) {
                deferred.reject(errors.invalid_unenc_privkey);
                return deferred.promise;
            }
            var expChecksum = bytes.slice(-4);
            bytes = bytes.slice(0, -4);
            var checksum = Bitcoin.CryptoJS.SHA256(Bitcoin.CryptoJS.SHA256(Bitcoin.convert.bytesToWordArray(bytes)));
            checksum = Bitcoin.convert.wordArrayToBytes(checksum);
            if (checksum[0] != expChecksum[0] || checksum[1] != expChecksum[1] || checksum[2] != expChecksum[2] || checksum[3] != expChecksum[3]) {
                deferred.reject(errors.invalid_unenc_privkey);
                return deferred.promise;
            }
            if (cur_net == 'testnet') {
                var version = 0xef;
            } else {
                var version = 0x80;
            }
            if (bytes[0] != version) {
                deferred.reject(errors.invalid_unenc_privkey);
                return deferred.promise;
            }
            bytes = bytes.slice(1, -1);
            sweep(Array.apply([], bytes));
            deferred.resolve();
        } else {
            if (window.cordova && cordova.platformId == 'android') {
                cordovaReady(function() {
                    cordova.exec(function(data) {
                        $scope.$apply(function() {
                            sweep(data);
                            deferred.resolve();
                        });
                    }, function(fail) {
                        deferred.reject([fail == 'invalid_passphrase', errors[fail] || fail]);
                    }, "BIP38", "decrypt", [encrypted_key, password,
                            'BTC']);  // probably not correct for testnet, but simpler, and compatible with our JS impl
                })();
            } else {
                var worker = new Worker(BASE_URL+"/static/js/bip38_worker.min.js");
                worker.onmessage = function(message) {
                    if (message.data.error) {
                        deferred.reject([message.data.error == 'invalid_passphrase',
                                         errors[message.data.error]]);
                    } else {
                        sweep(message.data);
                        deferred.resolve();
                    }
                }
                worker.postMessage({b58: encrypted_key,
                                    password: password});
            }
        }
        return deferred.promise;
    };

    $scope.processWalletVars().then(function() {
        $scope.clearWalletInitVars();

        if ($scope.wallet.redeem_key && !$scope.wallet.redeem_closed) {
            if ($scope.wallet.redeem_key.indexOf('K') == 0 || $scope.wallet.redeem_key.indexOf('L') == 0 || $scope.wallet.redeem_key.indexOf('c') == 0) {  // unencrypted
                redeem($scope.wallet.redeem_key).then(function() {
                    gaEvent('Wallet', 'SocialRedeemSuccessful');
                    $scope.wallet.redeem_closed = true;
                }, function(e) {
                    gaEvent('Wallet', 'SocialRedeemError', e);
                    notices.makeNotice('error', e);
                    $scope.wallet.redeem_closed = true;
                })
            } else {
                $scope.redeem_modal = {
                    redeem: function() {
                        var that = this;
                        this.decrypting = true;
                        this.error = undefined;
                        redeem($scope.wallet.redeem_key, this.password).then(function() {
                            gaEvent('Wallet', 'SocialRedeemSuccessful');
                            modal.close();
                        }, function(e) {
                            gaEvent('Wallet', 'SocialRedeemError', e[1]);
                            that.decrypting = false;
                            if (e[0]) that.error = e[1];
                            else {
                                modal.dismiss();
                                notices.makeNotice('error', e[1]);
                            }
                        })
                    }
                };

                var modal = $modal.open({
                    templateUrl: BASE_URL+'/'+LANG+'/wallet/partials/signuplogin/redeem_password_modal.html',
                    scope: $scope
                });
                gaEvent('Wallet', 'SocialRedeemModal');
                modal.result.finally(function() {
                    // don't show the modal twice
                    $scope.wallet.redeem_closed = true;
                });
            }
            $scope.redeem_shown = true;
        }
    });
}]);
