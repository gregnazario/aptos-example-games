import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import {RiseWallet} from "@rise-wallet/wallet-adapter";
import {PetraWallet} from "petra-plugin-wallet-adapter";
import {MartianWallet} from "@martianwallet/aptos-wallet-adapter";
import {PontemWallet} from "@pontem/wallet-adapter-plugin";
import {TrustWallet} from "@trustwallet/aptos-wallet-adapter";
import {
    AptosWalletAdapterProvider, NetworkName,
} from "@aptos-labs/wallet-adapter-react";
import {FewchaWallet} from "fewcha-plugin-wallet-adapter";
import {MSafeWalletAdapter} from "msafe-plugin-wallet-adapter";
import {WelldoneWallet} from "@welldone-studio/aptos-wallet-adapter";
import {NightlyWallet} from "@nightlylabs/aptos-wallet-adapter-plugin";
import {IdentityConnectWallet} from '@identity-connect/wallet-adapter-plugin';
import {Buffer as BufferPolyFill} from 'buffer';

const icDappId = '56746ba8-b4e1-4ddf-9c59-3b406b5b5e2a';

window.Buffer = BufferPolyFill;

const wallets = [
    new IdentityConnectWallet(icDappId, {networkName: NetworkName.Testnet}),
    new PetraWallet(),
    new MartianWallet(),
    new PontemWallet(),
    new RiseWallet(),
    new FewchaWallet(),
    new TrustWallet(),
    new MSafeWalletAdapter(),
    new WelldoneWallet(),
    new NightlyWallet()
];
const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);
root.render(
    <React.StrictMode>
        <AptosWalletAdapterProvider plugins={wallets} autoConnect={true}>
            <App/>
        </AptosWalletAdapterProvider>
    </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
