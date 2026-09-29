import MB from "./MB";
import fs from "fs";
import path from "path";

// ======================================================
// CẤU HÌNH LARAVEL
// ======================================================

const laravelPaymentUrl =
    "http://gpt.x/api/mb/payment";

const laravelSecret =
    "key";

// ======================================================
// CẤU HÌNH MB BANK
// ======================================================

const username = "0342234522";
const password = "Ndq0202@@";

if (!username || !password) {
    throw new Error("Thiếu username hoặc password");
}

// ======================================================
// MB - CHỈ TẠO 1 INSTANCE
// ======================================================

const mb = new MB({
    username,
    password,
});

// ======================================================
// CẤU HÌNH SERVICE
// ======================================================

const CHECK_INTERVAL = 30 * 1000;

// File lưu các refNo đã xử lý thành công
const processedFile = path.join(
    process.cwd(),
    "processed_refs.json"
);

// ======================================================
// LOAD REFNO ĐÃ XỬ LÝ
// ======================================================

function loadProcessedRefs(): Set<string> {
    try {
        if (!fs.existsSync(processedFile)) {
            return new Set();
        }

        const data = fs.readFileSync(
            processedFile,
            "utf8"
        );

        const refs = JSON.parse(data);

        if (!Array.isArray(refs)) {
            return new Set();
        }

        return new Set(
            refs.filter(
                (ref): ref is string =>
                    typeof ref === "string"
            )
        );
    } catch (error) {
        console.error(
            "⚠️ Không đọc được processed_refs.json:",
            error
        );

        return new Set();
    }
}

const processedRefs = loadProcessedRefs();

console.log(
    `💾 Đã load ${processedRefs.size} refNo đã xử lý`
);

// ======================================================
// SAVE REFNO
// ======================================================

function saveProcessedRefs(): void {
    try {
        fs.writeFileSync(
            processedFile,
            JSON.stringify(
                Array.from(processedRefs),
                null,
                2
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "❌ Không thể lưu processed_refs.json:",
            error
        );
    }
}

// ======================================================
// SLEEP
// ======================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

// ======================================================
// NGÀY HÔM NAY
// DD/MM/YYYY
// ======================================================

function getToday(): string {
    const now = new Date();

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const year = now.getFullYear();

    return `${day}/${month}/${year}`;
}

// ======================================================
// GỬI PAYMENT SANG LARAVEL
// ======================================================

async function sendPaymentToLaravel(
    tx: any,
    orderCode: string
): Promise<boolean> {

    const amount = Number(
        tx.creditAmount ?? 0
    );

    const content =
        tx.transactionDesc ?? "";

    const refNo =
        tx.refNo ?? null;

    if (!refNo) {
        console.log(
            "⚠️ Giao dịch không có refNo, bỏ qua"
        );

        return false;
    }

    if (amount <= 0) {
        console.log(
            `⚠️ ${refNo} số tiền không hợp lệ:`,
            amount
        );

        return false;
    }

    console.log("");
    console.log("========================================");
    console.log("📤 GỬI PAYMENT SANG LARAVEL");
    console.log("========================================");

    console.log("Order:", orderCode);
    console.log("Amount:", amount);
    console.log("RefNo:", refNo);
    console.log("Content:", content);

    try {
        const response = await fetch(
            laravelPaymentUrl,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "Accept":
                        "application/json",

                    "Authorization":
                        `Bearer ${laravelSecret}`,
                },

                body: JSON.stringify({
                    payment: {
                        transaction_id: refNo,
                        amount: amount,
                        content: content,

                        date:
                            tx.transactionDate ??
                            new Date().toISOString(),

                        account_receiver:
                            tx.accountNumber ?? null,

                        gate: "MBBANK",
                    },
                }),
            }
        );

        const responseText =
            await response.text();

        console.log(
            `📡 Laravel HTTP ${response.status}`
        );

        console.log(
            "Laravel:",
            responseText
        );

        if (!response.ok) {
            console.error(
                "❌ Laravel từ chối giao dịch"
            );

            return false;
        }

        console.log(
            "✅ Laravel đã nhận giao dịch"
        );

        return true;

    } catch (error) {

        console.error(
            "❌ Không kết nối được Laravel:",
            error
        );

        return false;
    }
}

// ======================================================
// LẤY GIAO DỊCH HÔM NAY
// ======================================================

async function getTodayTransactions() {

    const balance =
        await mb.getBalance();

    if (
        !balance?.balances?.length
    ) {
        throw new Error(
            "Không lấy được danh sách tài khoản MB"
        );
    }

    const today =
        getToday();

    const result: any[] = [];

    for (
        const account of balance.balances
    ) {

        if (!account.number) {
            continue;
        }

        try {

            const transactions =
                await mb.getTransactionsHistory({
                    accountNumber:
                        account.number,

                    fromDate:
                        today,

                    toDate:
                        today,
                });

            for (
                const tx of transactions ?? []
            ) {

                result.push({
                    accountNumber:
                        account.number,

                    transactionDate:
                        tx.transactionDate,

                    postDate:
                        tx.postDate,

                    creditAmount:
                        tx.creditAmount ?? null,

                    debitAmount:
                        tx.debitAmount ?? null,

                    balanceAvailable:
                        tx.balanceAvailable ??
                        null,

                    transactionDesc:
                        tx.transactionDesc ??
                        "",

                    toAccountName:
                        tx.toAccountName ??
                        null,

                    toAccountNumber:
                        tx.toAccountNumber ??
                        null,

                    toBank:
                        tx.toBank ??
                        null,

                    refNo:
                        tx.refNo ??
                        null,
                });
            }

        } catch (error) {

            console.error(
                `❌ Lỗi lấy giao dịch ${account.number}:`,
                error
            );
        }
    }

    return result;
}

// ======================================================
// XỬ LÝ GIAO DỊCH
// ======================================================

async function processTransactions(
    transactions: any[]
): Promise<void> {

    for (
        const tx of transactions
    ) {

        const content =
            tx.transactionDesc ?? "";

        const refNo =
            tx.refNo ?? null;

        // ----------------------------------------------
        // Không có refNo
        // ----------------------------------------------

        if (!refNo) {
            continue;
        }

        // ----------------------------------------------
        // ĐÃ XỬ LÝ
        // ----------------------------------------------

        if (
            processedRefs.has(refNo)
        ) {
            continue;
        }

        // ----------------------------------------------
        // TÌM CICIKEY
        // ----------------------------------------------

        const match =
            content.match(
                /CICIKEY([0-9]{12})/
            );

        if (!match) {
            continue;
        }

        const orderCode =
            match[1];

        const amount =
            Number(
                tx.creditAmount ?? 0
            );

        console.log("");
        console.log(
            "🔔 PHÁT HIỆN GIAO DỊCH CICIKEY"
        );

        console.log(
            "Order:",
            orderCode
        );

        console.log(
            "Amount:",
            amount
        );

        console.log(
            "RefNo:",
            refNo
        );

        console.log(
            "Content:",
            content
        );

        // ----------------------------------------------
        // GỬI LARAVEL
        // ----------------------------------------------

        const success =
            await sendPaymentToLaravel(
                tx,
                orderCode
            );

        // ----------------------------------------------
        // CHỈ ĐÁNH DẤU KHI LARAVEL THÀNH CÔNG
        // ----------------------------------------------

        if (success) {

            processedRefs.add(refNo);

            saveProcessedRefs();

            console.log(
                `💾 Đã lưu refNo: ${refNo}`
            );

        } else {

            console.log(
                `⚠️ Chưa đánh dấu ${refNo}, lần sau sẽ thử lại`
            );
        }
    }
}

// ======================================================
// CHẠY 1 VÒNG
// ======================================================

async function runOnce(): Promise<void> {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        `🚀 Kiểm tra MB: ${new Date().toLocaleString(
            "vi-VN"
        )}`
    );

    console.log(
        "========================================"
    );

    try {

        const transactions =
            await getTodayTransactions();

        console.log(
            `📜 Tìm thấy ${transactions.length} giao dịch`
        );

        await processTransactions(
            transactions
        );

    } catch (error) {

        console.error(
            "❌ Lỗi vòng kiểm tra:",
            error
        );
    }
}

// ======================================================
// SERVICE LOOP
// ======================================================

async function loop(): Promise<void> {

    console.log("");
    console.log(
        "========================================"
    );

    console.log(
        "🏦 CICI MB PAYMENT SERVICE"
    );

    console.log(
        "⏱️ Chu kỳ: 30 giây"
    );

    console.log(
        `💾 Ref đã xử lý: ${processedRefs.size}`
    );

    console.log(
        "========================================"
    );

    while (true) {

        await runOnce();

        console.log("");
        console.log(
            "⏳ Chờ 30 giây..."
        );

        await sleep(
            CHECK_INTERVAL
        );
    }
}

// ======================================================
// START
// ======================================================

loop().catch((error) => {

    console.error(
        "❌ FATAL ERROR:",
        error
    );

    process.exit(1);
});
