import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import {PetraWallet} from "petra-plugin-wallet-adapter";
import {
    AptosWalletAdapterProvider,
} from "@aptos-labs/wallet-adapter-react";
import {Buffer as BufferPolyFill} from 'buffer';

window.Buffer = BufferPolyFill;

const wallets = [
    new PetraWallet(),
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
