import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// FULL KNOWLEDGE BASE  (scraped from https://developer.sslcommerz.com/doc/v4/)
// ─────────────────────────────────────────────────────────────────────────────
const KB = {

    overview: `
SSLCommerz is the first payment gateway in Bangladesh. It lets merchants accept
payments via credit/debit cards, mobile banking, and internet banking.

Two integration types:
  1. Easy Checkout  – embedded JS popup within your site
  2. Hosted Payment – redirect customer to SSLCommerz hosted page

Three APIs you must use:
  1. Create & Get Session  (initiate payment)
  2. IPN Listener          (receive payment notification)
  3. Order Validation API  (confirm payment is genuine)

IMPORTANT: Only TLS 1.2 or higher is accepted.
Test with: curl "https://sandbox.sslcommerz.com/public/tls/" -v
Expected output: "TLS is okay"
`,

    environments: {
        sandbox: {
            base_url: "https://sandbox.sslcommerz.com",
            initiate_payment: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
            validate_payment: "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php",
            refund: "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
            transaction_query: "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
            registration: "https://developer.sslcommerz.com/registration/",
            embed_script: "https://sandbox.sslcommerz.com/embed.min.js",
            ips: ["103.26.139.87"],
            note: "Test transactions — no real money involved",
        },
        live: {
            base_url: "https://securepay.sslcommerz.com",
            initiate_payment: "https://securepay.sslcommerz.com/gwprocess/v4/api.php",
            validate_payment: "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php",
            refund: "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
            transaction_query: "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
            registration: "https://signup.sslcommerz.com/register",
            embed_script: "https://seamless-epay.sslcommerz.com/embed.min.js",
            ips: ["103.26.139.81", "103.132.153.81"],
            outbound_ips: ["103.26.139.148", "103.132.153.148"],
            note: "Real transactions — live money",
        },
    },

    test_cards: {
        visa: { number: "4111111111111111", exp: "12/26", cvv: "111" },
        master: { number: "5111111111111111", exp: "12/26", cvv: "111" },
        amex: { number: "371111111111111", exp: "12/26", cvv: "111" },
        mobile_otp: "111111 or 123456",
        sandbox_store_id: "testbox",
        sandbox_store_passwd: "qwerty",
    },

    payment_flow: `
Step-by-step payment flow:

1. Customer confirms checkout on merchant site
2. Merchant server POST → SSLCommerz initiation API
3. SSLCommerz returns GatewayPageURL + sessionkey
4. Merchant redirects customer to GatewayPageURL
5. Customer pays on SSLCommerz page
6. SSLCommerz sends IPN POST to merchant's IPN URL (server-to-server)
7. Merchant receives IPN, validates with Order Validation API
8. SSLCommerz redirects customer back to success/fail/cancel URL
9. Merchant shows service confirmation to customer

CRITICAL: Always validate via API — never trust IPN POST alone.
CRITICAL: Always save sessionkey from step 3 for future queries.
`,

    request_params: {
        integration_required: [
            { name: "store_id", type: "string(30)", required: true, desc: "Your SSLCommerz Store ID" },
            { name: "store_passwd", type: "string(30)", required: true, desc: "Your SSLCommerz Store Password" },
            { name: "total_amount", type: "decimal(10,2)", required: true, desc: "Amount to charge. Min: 10 BDT, Max: 500000 BDT" },
            { name: "currency", type: "string(3)", required: true, desc: "BDT, USD, EUR, SGD, INR, MYR etc. Non-BDT is auto-converted." },
            { name: "tran_id", type: "string(30)", required: true, desc: "Your unique transaction ID" },
            { name: "success_url", type: "string(255)", required: true, desc: "Redirect URL after successful payment" },
            { name: "fail_url", type: "string(255)", required: true, desc: "Redirect URL after payment failure" },
            { name: "cancel_url", type: "string(255)", required: true, desc: "Redirect URL if customer cancels" },
            { name: "ipn_url", type: "string(255)", required: false, desc: "IPN listener URL — highly recommended to avoid missed notifications" },
            { name: "multi_card_name", type: "string(30)", required: false, desc: "Control which gateways appear. e.g. mastercard,visacard,amexcard. Leave blank for all." },
        ],
        customer: [
            { name: "cus_name", type: "string(50)", required: true, desc: "Customer name" },
            { name: "cus_email", type: "string(50)", required: true, desc: "Customer email for payment receipt" },
            { name: "cus_add1", type: "string(50)", required: false, desc: "Address line 1" },
            { name: "cus_add2", type: "string(50)", required: false, desc: "Address line 2" },
            { name: "cus_city", type: "string(50)", required: false, desc: "City" },
            { name: "cus_state", type: "string(50)", required: false, desc: "State" },
            { name: "cus_postcode", type: "string(30)", required: false, desc: "Postcode" },
            { name: "cus_country", type: "string(50)", required: false, desc: "Country" },
            { name: "cus_phone", type: "string(20)", required: true, desc: "Phone number. Required for SSLCOMMERZ_LOGISTIC." },
            { name: "cus_fax", type: "string(20)", required: false, desc: "Fax number" },
        ],
        shipment: [
            { name: "shipping_method", type: "string(50)", required: true, desc: "YES / NO / Courier / SSLCOMMERZ_LOGISTIC" },
            { name: "ship_name", type: "string(50)", required: "if shipping_method=YES", desc: "Recipient name" },
            { name: "ship_add1", type: "string(50)", required: "if shipping_method=YES", desc: "Shipping address line 1" },
            { name: "ship_city", type: "string(50)", required: "if shipping_method=YES", desc: "Shipping city" },
            { name: "ship_postcode", type: "string(50)", required: "if shipping_method=YES", desc: "Shipping postcode" },
            { name: "ship_country", type: "string(50)", required: "if shipping_method=YES", desc: "Shipping country" },
            { name: "num_of_item", type: "integer(1)", required: "if SSLCOMMERZ_LOGISTIC", desc: "Number of items" },
        ],
        product: [
            { name: "product_name", type: "string(255)", required: true, desc: "Product name(s), comma-separated" },
            { name: "product_category", type: "string(100)", required: true, desc: "Category e.g. electronics, clothing, topup" },
            { name: "product_profile", type: "string(100)", required: true, desc: "One of: general | physical-goods | non-physical-goods | airline-tickets | travel-vertical | telecom-vertical" },
            { name: "product_amount", type: "decimal(10,2)", required: false, desc: "Product price for reconciliation" },
            { name: "vat", type: "decimal(10,2)", required: false, desc: "VAT amount" },
            { name: "discount_amount", type: "decimal(10,2)", required: false, desc: "Discount amount" },
            { name: "convenience_fee", type: "decimal(10,2)", required: false, desc: "Convenience fee" },
            { name: "cart", type: "json", required: false, desc: 'JSON array: [{"sku":"...","product":"...","quantity":"1","amount":"200.00","unit_price":"200.00"}]' },
        ],
        emi: [
            { name: "emi_option", type: "integer(1)", required: "if EMI", desc: "1 = enable EMI option" },
            { name: "emi_max_inst_option", type: "integer(2)", required: false, desc: "Max instalment e.g. 3,6,9" },
            { name: "emi_selected_inst", type: "integer(2)", required: false, desc: "Pre-selected instalment from your site" },
            { name: "emi_allow_only", type: "integer(1)", required: false, desc: "1 = EMI only, hides mobile/internet banking" },
        ],
        airline_specific: [
            { name: "hours_till_departure", required: "if product_profile=airline-tickets", desc: "e.g. 12 hrs" },
            { name: "flight_type", required: "if product_profile=airline-tickets", desc: "Oneway / Return / Multistop" },
            { name: "pnr", required: "if product_profile=airline-tickets", desc: "PNR code" },
            { name: "journey_from_to", required: "if product_profile=airline-tickets", desc: "e.g. DAC-CGP" },
            { name: "third_party_booking", required: "if product_profile=airline-tickets", desc: "Yes / No" },
        ],
        travel_specific: [
            { name: "hotel_name", required: "if product_profile=travel-vertical", desc: "Hotel name" },
            { name: "length_of_stay", required: "if product_profile=travel-vertical", desc: "e.g. 2 days" },
            { name: "check_in_time", required: "if product_profile=travel-vertical", desc: "e.g. 24 hrs" },
            { name: "hotel_city", required: "if product_profile=travel-vertical", desc: "e.g. Dhaka" },
        ],
        telecom_specific: [
            { name: "product_type", required: "if product_profile=telecom-vertical", desc: "Prepaid / Postpaid" },
            { name: "topup_number", required: "if product_profile=telecom-vertical", desc: "Mobile number e.g. 8801700000000" },
            { name: "country_topup", required: "if product_profile=telecom-vertical", desc: "e.g. Bangladesh" },
        ],
        custom: [
            { name: "value_a", type: "string(255)", desc: "Custom metadata field A" },
            { name: "value_b", type: "string(255)", desc: "Custom metadata field B" },
            { name: "value_c", type: "string(255)", desc: "Custom metadata field C" },
            { name: "value_d", type: "string(255)", desc: "Custom metadata field D" },
        ],
    },

    response_params: {
        initiation: [
            { name: "status", desc: "SUCCESS or FAILED" },
            { name: "failedreason", desc: "Failure message if status=FAILED" },
            { name: "sessionkey", desc: "Save this! Use for transaction queries" },
            { name: "GatewayPageURL", desc: "Redirect customer to this URL to pay" },
            { name: "gw", desc: "Available gateway keys grouped by type (visa, master, amex, othercards, internetbanking, mobilebanking)" },
            { name: "storeBanner", desc: "Banner image URL" },
            { name: "storeLogo", desc: "Logo image URL" },
        ],
        ipn: [
            { name: "status", desc: "VALID | FAILED | CANCELLED | UNATTEMPTED | EXPIRED" },
            { name: "tran_id", desc: "Your transaction ID — validate against your DB" },
            { name: "val_id", desc: "SSLCommerz validation ID — use for Order Validation API" },
            { name: "amount", desc: "Amount paid — validate against your DB" },
            { name: "store_amount", desc: "Amount you receive after bank commission" },
            { name: "currency", desc: "Currency settled" },
            { name: "bank_tran_id", desc: "Bank's transaction ID" },
            { name: "card_type", desc: "e.g. VISA-Dutch Bangla" },
            { name: "card_brand", desc: "VISA / MASTER / AMEX / IB / MOBILE BANKING" },
            { name: "verify_sign", desc: "Hash for signature verification" },
            { name: "verify_key", desc: "Keys used in hash" },
            { name: "risk_level", desc: "0 = safe, 1 = risky — hold service if 1" },
            { name: "risk_title", desc: "Safe or description of risk" },
        ],
        validation: [
            { name: "status", desc: "VALID | VALIDATED | INVALID_TRANSACTION" },
            { name: "tran_id", desc: "Your transaction ID" },
            { name: "val_id", desc: "Validation ID" },
            { name: "amount", desc: "Transaction amount" },
            { name: "store_amount", desc: "Amount after bank commission" },
            { name: "risk_level", desc: "0 safe, 1 risky" },
        ],
    },

    gateways: {
        cards: {
            visa: ["dbbl_visa", "brac_visa", "city_visa", "ebl_visa", "visacard"],
            master: ["dbbl_master", "brac_master", "city_master", "ebl_master", "mastercard"],
            amex: ["city_amex", "amexcard"],
            other: ["dbbl_nexus", "qcash", "fastcash"],
        },
        internet_banking: ["city", "bankasia", "ibbl", "mtbl"],
        mobile_banking: ["bkash", "dbblmobilebanking", "abbank", "upay", "tapnpay"],
        group_keys: {
            internetbank: "All internet banking",
            mobilebank: "All mobile banking",
            othercard: "All non-visa/master/amex cards",
            visacard: "All Visa",
            mastercard: "All Mastercard",
            amexcard: "All Amex",
        },
    },

    transaction_statuses: {
        VALID: "Successful transaction — update your DB",
        VALIDATED: "Already validated by you — duplicate call",
        FAILED: "Declined by issuer bank",
        CANCELLED: "Customer cancelled",
        UNATTEMPTED: "Customer did not select any payment channel",
        EXPIRED: "Payment timeout",
        INVALID_TRANSACTION: "Invalid val_id submitted to validation API",
        PENDING: "Transaction still processing",
    },

    security_checklist: [
        "Always call Order Validation API before marking order as paid",
        "Validate tran_id exists in your database",
        "Validate amount matches your stored order amount",
        "Validate currency matches",
        "Check risk_level — hold service if risk_level=1",
        "Never trust only the IPN POST — always cross-validate",
        "Register your public IP with SSLCommerz for live refund API",
        "Use HTTPS for all callback URLs",
        "IPN listener must be accessible from the internet (port 80 or 443)",
        "Whitelist SSLCommerz IPs at your firewall",
    ],

    refund_api: {
        description: "Initiate a refund for a completed transaction",
        endpoint_sandbox: "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
        endpoint_live: "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
        method: "GET",
        request_params: [
            { name: "bank_tran_id", required: true, desc: "Bank transaction ID from original payment" },
            { name: "refund_trans_id", required: true, desc: "Your unique refund transaction ID (new param from 24/02/2025)" },
            { name: "store_id", required: true, desc: "Your store ID" },
            { name: "store_passwd", required: true, desc: "Your store password" },
            { name: "refund_amount", required: true, desc: "Amount to refund" },
            { name: "refund_remarks", required: true, desc: "Reason for refund" },
            { name: "refe_id", required: false, desc: "Your reference number for reconciliation" },
            { name: "format", required: false, desc: "json or xml (default: json)" },
        ],
        response_statuses: {
            success: "Refund request initiated successfully",
            failed: "Refund request failed to initiate",
            processing: "Refund already initiated (duplicate request)",
        },
        note: "Your public IP must be registered at SSLCommerz Live System",
    },

    query_api: {
        description: "Query transaction status by session ID or transaction ID",
        endpoint_sandbox: "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
        endpoint_live: "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php",
        method: "GET",
        by_session: "Add ?sessionkey=XXX&store_id=XX&store_passwd=XX&format=json",
        by_tran_id: "Add ?tran_id=XXX&store_id=XX&store_passwd=XX&format=json",
    },

    easy_checkout: {
        description: "Embedded popup payment without leaving your site",
        step1_sandbox: `
(function (window, document) {
  var loader = function () {
    var script = document.createElement("script"),
        tag = document.getElementsByTagName("script")[0];
    script.src = "https://sandbox.sslcommerz.com/embed.min.js?" + Math.random().toString(36).substring(7);
    tag.parentNode.insertBefore(script, tag);
  };
  window.addEventListener ? window.addEventListener("load", loader, false)
                           : window.attachEvent("onload", loader);
})(window, document);`,
        step1_live: `
(function (window, document) {
  var loader = function () {
    var script = document.createElement("script"),
        tag = document.getElementsByTagName("script")[0];
    script.src = "https://seamless-epay.sslcommerz.com/embed.min.js?" + Math.random().toString(36).substring(7);
    tag.parentNode.insertBefore(script, tag);
  };
  window.addEventListener ? window.addEventListener("load", loader, false)
                           : window.attachEvent("onload", loader);
})(window, document);`,
        step2_button: `
<button class="your-button-class" id="sslczPayBtn"
  token="optional_token"
  postdata="your_js_data_object"
  order="optional_existing_order_id"
  endpoint="/your-backend-initiation-url">
  Pay Now
</button>`,
    },

    common_issues: {
        network: [
            "IPN listener must use port 80 or 443",
            "IPN URL must be publicly accessible from the internet",
            "Whitelist SSLCommerz IPs at your firewall",
            "Sandbox IP to whitelist: 103.26.139.87",
            "Live IPs to whitelist: 103.26.139.81, 103.132.153.81",
            "Your server must reach TCP 443 of 103.26.139.148 and 103.132.153.148",
        ],
        tls: "Only TLS 1.2+ is accepted. Test: curl 'https://sandbox.sslcommerz.com/public/tls/' -v",
        local_dev: "Set CURLOPT_SSL_VERIFYPEER to FALSE when testing from localhost only",
    },

    libraries: {
        nodejs: "npm install sslcommerz-lts",
        php: "composer require sslcommerz/sslcommerz-php",
        python: "pip install sslcommerz",
        laravel: "composer require karim007/laravel-sslcommerz-tokenize",
        github: "https://github.com/sslcommerz",
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// CODE SNIPPETS
// ─────────────────────────────────────────────────────────────────────────────
const SNIPPETS = {

    nodejs_initiate: `
const SSLCommerzPayment = require('sslcommerz-lts');

const store_id    = 'your_store_id';
const store_passwd = 'your_store_password';
const is_live     = false; // true for production

const data = {
  total_amount:     100,
  currency:         'BDT',
  tran_id:          'TXN_' + Date.now(),
  success_url:      'https://yoursite.com/payment/success',
  fail_url:         'https://yoursite.com/payment/fail',
  cancel_url:       'https://yoursite.com/payment/cancel',
  ipn_url:          'https://yoursite.com/payment/ipn',
  cus_name:         'John Doe',
  cus_email:        'john@example.com',
  cus_phone:        '01711111111',
  cus_add1:         'Dhaka',
  cus_city:         'Dhaka',
  cus_country:      'Bangladesh',
  shipping_method:  'NO',
  product_name:     'My Product',
  product_category: 'general',
  product_profile:  'general',
};

const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
const apiResponse = await sslcz.init(data);

if (apiResponse.GatewayPageURL) {
  res.redirect(apiResponse.GatewayPageURL); // redirect customer
} else {
  console.error('Init failed:', apiResponse.failedreason);
}`,

    nodejs_validate_ipn: `
// Express route for success_url / ipn_url callback
app.post('/payment/success', async (req, res) => {
  const { val_id, tran_id, amount, currency } = req.body;

  const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
  const data  = await sslcz.validate({ val_id });

  if (data.status === 'VALID' || data.status === 'VALIDATED') {
    // Verify against YOUR database
    const order = await Order.findOne({ tran_id });
    if (!order) return res.send('Invalid transaction');
    if (parseFloat(order.amount) !== parseFloat(data.amount)) return res.send('Amount mismatch');
    if (data.risk_level === '1') return res.send('Risky transaction - hold service');

    // ✅ All checks passed — mark order as paid
    await order.update({ status: 'paid' });
    res.redirect('/order/success/' + order.id);
  } else {
    res.redirect('/payment/failed');
  }
});`,

    nodejs_refund: `
const bank_tran_id   = 'BANK_TXN_ID_FROM_IPN';
const refund_amount  = '50.00';
const refund_remarks = 'Customer requested refund';
const refund_trans_id = 'REFUND_' + Date.now(); // unique refund ID

const url = \`https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php\`
          + \`?bank_tran_id=\${bank_tran_id}\`
          + \`&refund_trans_id=\${refund_trans_id}\`
          + \`&refund_amount=\${refund_amount}\`
          + \`&refund_remarks=\${encodeURIComponent(refund_remarks)}\`
          + \`&store_id=\${store_id}\`
          + \`&store_passwd=\${store_passwd}\`
          + \`&v=1&format=json\`;

const response = await fetch(url);
const result   = await response.json();
console.log(result.status); // success | failed | processing`,

    nodejs_query_by_tran: `
const url = \`https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php\`
          + \`?tran_id=\${tran_id}&store_id=\${store_id}&store_passwd=\${store_passwd}&format=json\`;

const response = await fetch(url);
const result   = await response.json();

if (result.APIConnect === 'DONE') {
  result.element.forEach(t => {
    console.log(t.status, t.amount, t.risk_level);
  });
}`,

    php_initiate: `
<?php
$post_data = [
  'store_id'         => 'testbox',
  'store_passwd'     => 'qwerty',
  'total_amount'     => 100,
  'currency'         => 'BDT',
  'tran_id'          => 'TXN_' . uniqid(),
  'success_url'      => 'https://yoursite.com/success.php',
  'fail_url'         => 'https://yoursite.com/fail.php',
  'cancel_url'       => 'https://yoursite.com/cancel.php',
  'ipn_url'          => 'https://yoursite.com/ipn.php',
  'cus_name'         => 'John Doe',
  'cus_email'        => 'john@example.com',
  'cus_phone'        => '01711111111',
  'cus_add1'         => 'Dhaka',
  'cus_city'         => 'Dhaka',
  'cus_country'      => 'Bangladesh',
  'shipping_method'  => 'NO',
  'product_name'     => 'My Product',
  'product_category' => 'general',
  'product_profile'  => 'general',
];

$handle = curl_init();
curl_setopt($handle, CURLOPT_URL, 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php');
curl_setopt($handle, CURLOPT_TIMEOUT, 30);
curl_setopt($handle, CURLOPT_POST, 1);
curl_setopt($handle, CURLOPT_POSTFIELDS, $post_data);
curl_setopt($handle, CURLOPT_RETURNTRANSFER, true);
curl_setopt($handle, CURLOPT_SSL_VERIFYPEER, FALSE); // remove in production

$content = curl_exec($handle);
$sslcz = json_decode($content, true);

if (!empty($sslcz['GatewayPageURL'])) {
  header('Location: ' . $sslcz['GatewayPageURL']);
  exit;
}`,

    php_validate: `
<?php // success.php or ipn.php
$val_id      = urlencode($_POST['val_id']);
$store_id    = urlencode('testbox');
$store_passwd = urlencode('qwerty');

$url = "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
     . "?val_id=$val_id&store_id=$store_id&store_passwd=$store_passwd&v=1&format=json";

$handle = curl_init();
curl_setopt($handle, CURLOPT_URL, $url);
curl_setopt($handle, CURLOPT_RETURNTRANSFER, true);
curl_setopt($handle, CURLOPT_SSL_VERIFYPEER, false);
$result = json_decode(curl_exec($handle));

if ($result->status === 'VALID' || $result->status === 'VALIDATED') {
  // Validate tran_id and amount against your DB!
  if ($result->risk_level == 1) {
    // Hold service — risky transaction
  }
  // ✅ Mark order paid in DB
}`,

    python_initiate: `
import requests

store_id    = 'your_store_id'
store_passwd = 'your_store_password'
is_sandbox  = True

base_url = 'https://sandbox.sslcommerz.com' if is_sandbox else 'https://securepay.sslcommerz.com'

data = {
  'store_id':         store_id,
  'store_passwd':     store_passwd,
  'total_amount':     100,
  'currency':         'BDT',
  'tran_id':          'TXN_123456',
  'success_url':      'https://yoursite.com/success',
  'fail_url':         'https://yoursite.com/fail',
  'cancel_url':       'https://yoursite.com/cancel',
  'cus_name':         'John Doe',
  'cus_email':        'john@example.com',
  'cus_phone':        '01711111111',
  'cus_add1':         'Dhaka',
  'cus_city':         'Dhaka',
  'cus_country':      'Bangladesh',
  'shipping_method':  'NO',
  'product_name':     'My Product',
  'product_category': 'general',
  'product_profile':  'general',
}

response = requests.post(f'{base_url}/gwprocess/v4/api.php', data=data)
result   = response.json()

if result.get('GatewayPageURL'):
    print('Redirect to:', result['GatewayPageURL'])
    # return redirect(result['GatewayPageURL'])  # in Flask/Django
`,

    nextjs_initiate: `
// pages/api/payment/initiate.js  (Next.js API route)
import SSLCommerzPayment from 'sslcommerz-lts';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { amount, customerName, customerEmail, customerPhone } = req.body;

  const data = {
    total_amount:     amount,
    currency:         'BDT',
    tran_id:          'TXN_' + Date.now(),
    success_url:      \`\${process.env.BASE_URL}/api/payment/success\`,
    fail_url:         \`\${process.env.BASE_URL}/api/payment/fail\`,
    cancel_url:       \`\${process.env.BASE_URL}/api/payment/cancel\`,
    ipn_url:          \`\${process.env.BASE_URL}/api/payment/ipn\`,
    cus_name:         customerName,
    cus_email:        customerEmail,
    cus_phone:        customerPhone,
    cus_add1:         'Dhaka',
    cus_city:         'Dhaka',
    cus_country:      'Bangladesh',
    shipping_method:  'NO',
    product_name:     'Order',
    product_category: 'general',
    product_profile:  'general',
  };

  const sslcz = new SSLCommerzPayment(
    process.env.STORE_ID,
    process.env.STORE_PASSWD,
    process.env.NODE_ENV === 'production'
  );

  const apiResponse = await sslcz.init(data);
  res.json({ url: apiResponse.GatewayPageURL });
}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Q&A ENGINE  — simple keyword matching over the knowledge base
// ─────────────────────────────────────────────────────────────────────────────
function answerQuestion(question) {
    const q = question.toLowerCase();

    // ── URLs / Endpoints ──
    if (q.match(/url|endpoint|api.*(sandbox|live|test|prod)/)) {
        return JSON.stringify(KB.environments, null, 2);
    }
    if (q.match(/sandbox|test.*url|test.*endpoint/)) {
        return JSON.stringify(KB.environments.sandbox, null, 2);
    }
    if (q.match(/live|production.*url|prod.*endpoint/)) {
        return JSON.stringify(KB.environments.live, null, 2);
    }

    // ── Test cards ──
    if (q.match(/test.*card|card.*number|sandbox.*card|credit.*card|demo.*card/)) {
        return JSON.stringify(KB.test_cards, null, 2);
    }

    // ── Payment flow ──
    if (q.match(/how.*work|flow|process|step|overview|integration.*process/)) {
        return KB.payment_flow;
    }

    // ── Required params ──
    if (q.match(/required.*param|mandatory|what.*param|param.*list|field/)) {
        return JSON.stringify(KB.request_params.integration_required, null, 2)
            + "\n\nCustomer fields:\n" + JSON.stringify(KB.request_params.customer, null, 2)
            + "\n\nProduct fields:\n" + JSON.stringify(KB.request_params.product, null, 2);
    }

    // ── IPN ──
    if (q.match(/ipn|instant.*payment.*notif|notification|listener/)) {
        return `IPN (Instant Payment Notification) Guide:

- SSLCommerz POSTs to your ipn_url after each payment (server-to-server)
- Customer session is NOT available in IPN — it's server-to-server
- You MUST validate the IPN using the Order Validation API (don't trust IPN alone)
- IPN URL must be on port 80 or 443 and publicly accessible

IPN POST fields:
${JSON.stringify(KB.response_params.ipn, null, 2)}

Security: verify_sign and verify_key are provided for signature validation.
risk_level=1 means risky — hold the service and request customer verification.`;
    }

    // ── Validation ──
    if (q.match(/validat|confirm.*payment|verify.*payment|order.*validat/)) {
        return `Order Validation API:

Sandbox: GET https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php
Live:    GET https://securepay.sslcommerz.com/validator/api/validationserverAPI.php

Required params: val_id, store_id, store_passwd
Optional:        format=json (default) or xml

Response statuses:
${JSON.stringify(KB.transaction_statuses, null, 2)}

Security checklist:
${KB.security_checklist.map((s, i) => (i + 1) + '. ' + s).join('\n')}`;
    }

    // ── Refund ──
    if (q.match(/refund/)) {
        return JSON.stringify(KB.refund_api, null, 2);
    }

    // ── Transaction query ──
    if (q.match(/query.*transaction|transaction.*status|check.*transaction|session.*key/)) {
        return JSON.stringify(KB.query_api, null, 2);
    }

    // ── Status codes ──
    if (q.match(/status|VALID|FAILED|CANCEL|EXPIRED|UNATTEMPTED|PENDING/i)) {
        return JSON.stringify(KB.transaction_statuses, null, 2);
    }

    // ── Gateways ──
    if (q.match(/gateway|bkash|visa|master|amex|nexus|internet.*bank|mobile.*bank/)) {
        return JSON.stringify(KB.gateways, null, 2);
    }

    // ── EMI ──
    if (q.match(/emi|installment|instalment/)) {
        return `EMI Parameters:
${JSON.stringify(KB.request_params.emi, null, 2)}

- Set emi_option=1 to enable EMI
- emi_max_inst_option: max instalments shown at gateway (e.g. 3,6,9)
- emi_selected_inst: pre-select instalment from your site
- emi_allow_only=1: only show EMI options (hides mobile/internet banking)`;
    }

    // ── Easy checkout / popup ──
    if (q.match(/easy.?checkout|popup|embed|pop.?up/)) {
        return `Easy Checkout (Popup Integration):

Step 1 — Add embed script before </body>:
SANDBOX:${KB.easy_checkout.step1_sandbox}

LIVE:${KB.easy_checkout.step1_live}

Step 2 — Add payment button:
${KB.easy_checkout.step2_button}

Step 3 — Your backend endpoint receives a POST and calls the initiation API,
returning JSON: { status: 'success', data: GatewayPageURL, logo: storeLogo }`;
    }

    // ── Security ──
    if (q.match(/secur|risk|fraud|checkli/)) {
        return `Security Checklist:\n${KB.security_checklist.map((s, i) => (i + 1) + '. ' + s).join('\n')}`;
    }

    // ── Network / firewall ──
    if (q.match(/network|firewall|ip.*whitelist|whitelist.*ip|port|tls|ssl/)) {
        return JSON.stringify(KB.common_issues, null, 2);
    }

    // ── Libraries / SDKs ──
    if (q.match(/library|sdk|npm|pip|composer|package|install/)) {
        return JSON.stringify(KB.libraries, null, 2);
    }

    // ── Currency ──
    if (q.match(/currenc/)) {
        return `Supported currencies: BDT, USD, EUR, SGD, INR, MYR and others.
Non-BDT amounts are auto-converted to BDT at current exchange rates.
The 'currency' and 'currency_amount' fields in the response show original values.
The 'amount' field shows the BDT equivalent.`;
    }

    // ── Amount limits ──
    if (q.match(/amount.*limit|min.*amount|max.*amount|limit.*amount/)) {
        return `Transaction amount must be between 10.00 BDT and 500,000.00 BDT.
Use decimal(10,2) format. Example: 55.40`;
    }

    // ── Registration ──
    if (q.match(/register|sign.?up|account|create.*store/)) {
        return `Registration:
Sandbox/Test: https://developer.sslcommerz.com/registration/
Live/Production: https://signup.sslcommerz.com/register`;
    }

    // ── Overview / what is ──
    if (q.match(/what is|about|overview|sslcommerz/)) {
        return KB.overview;
    }

    // ── Airline / travel / telecom specific ──
    if (q.match(/airline|flight|ticket/)) {
        return JSON.stringify(KB.request_params.airline_specific, null, 2);
    }
    if (q.match(/hotel|travel|stay/)) {
        return JSON.stringify(KB.request_params.travel_specific, null, 2);
    }
    if (q.match(/telecom|topup|top.?up|recharge/)) {
        return JSON.stringify(KB.request_params.telecom_specific, null, 2);
    }

    // ── Fallback ──
    return `I couldn't find a specific match for your question. Here are the topics I can answer:

• What is SSLCommerz / overview
• Integration types (Easy Checkout vs Hosted)
• Payment flow / process steps
• API endpoints (sandbox & live URLs)
• Request parameters (all fields)
• Test credit cards / sandbox credentials
• IPN (Instant Payment Notification)
• Order Validation API
• Transaction statuses (VALID, FAILED, etc.)
• Available payment gateways
• EMI integration
• Refund API
• Transaction query API
• Security checklist
• Network / firewall / IP whitelist
• SDK libraries (Node.js, PHP, Python, Laravel)
• Registration / account setup
• Currency support and limits

Try asking: "What are the required parameters?" or "How does IPN work?" or "Show me the sandbox URLs"`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER SETUP
// ─────────────────────────────────────────────────────────────────────────────
const server = new Server(
    { name: "sslcommerz-knowledge-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "ask_sslcommerz",
            description:
                "Ask any question about SSLCommerz integration in plain English. " +
                "Covers: payment flow, API endpoints, parameters, IPN, validation, " +
                "refund, transaction query, test cards, gateways, security, SDKs, EMI, and more.",
            inputSchema: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "Your question in plain English. E.g. 'What are the required parameters?' or 'How does IPN work?'",
                    },
                },
                required: ["question"],
            },
        },
        {
            name: "get_code_snippet",
            description: "Get a ready-to-use SSLCommerz code snippet for a specific language and use case.",
            inputSchema: {
                type: "object",
                properties: {
                    language: {
                        type: "string",
                        enum: ["nodejs_initiate", "nodejs_validate_ipn", "nodejs_refund", "nodejs_query_by_tran", "php_initiate", "php_validate", "python_initiate", "nextjs_initiate"],
                    },
                },
                required: ["language"],
            },
        },
        {
            name: "get_sslcommerz_info",
            description: "Get structured SSLCommerz data by topic.",
            inputSchema: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        enum: ["environments", "test_cards", "request_params", "response_params", "gateways", "transaction_statuses", "security_checklist", "refund_api", "query_api", "libraries", "easy_checkout", "common_issues"],
                    },
                },
                required: ["topic"],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "ask_sslcommerz") {
        const answer = answerQuestion(args.question);
        return { content: [{ type: "text", text: answer }] };
    }

    if (name === "get_code_snippet") {
        const snippet = SNIPPETS[args.language];
        if (!snippet) throw new Error(`Unknown snippet: ${args.language}`);
        return { content: [{ type: "text", text: snippet }] };
    }

    if (name === "get_sslcommerz_info") {
        const data = KB[args.topic];
        if (!data) throw new Error(`Unknown topic: ${args.topic}`);
        return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
});

// const transport = new StdioServerTransport();
// await server.connect(transport);
// console.error("✅ SSLCommerz Knowledge MCP server v2.0 running");

// Replace the bottom transport section with:
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Unknown session");
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SSLCommerz MCP running on port ${PORT}`));