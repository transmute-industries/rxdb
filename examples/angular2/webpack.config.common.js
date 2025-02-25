const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: {
        'polyfills': './app/polyfills.ts',
        'vendor': './app/vendor.ts',
        'app': './app/bootstrap.ts'
    },
    module: {
        rules: [{
            test: /\.ts?$/,
            loaders: ['awesome-typescript-loader?useWebpackText=true', 'angular2-template-loader'],
        }, {
            test: /\.html?$/,
            loaders: ['html-loader'],
        }, {
            test: /\.css$/,
            loader: ['style-loader', 'css-loader?-url']
        }, {
            test: /\.less$/,
            loader: ['style-loader', 'css-loader', 'less-loader']
        }, {
            test: /\.json$/,
            loader: 'raw-loader'
        }, {
            test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
            loader: 'url-loader?limit=10000&mimetype=application/font-woff'
        }, {
            test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
            loader: 'file-loader'
        }, {
            test: /\.js$/,
            loader: 'babel-loader',
            exclude: /node_modules/
        }]
    },

    output: {
        filename: '[name].[hash].bundle.js',
        sourceMapFilename: '[name].[hash].bundle.map',
        path: path.join(__dirname, 'dist'),
        publicPath: '/'
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'app/index.html',
            chunksSortMode: 'dependency'
        })
    ],
    optimization: {
        splitChunks: false
    },
    resolve: {
        extensions: ['.js', '.ts']
    },
    node: {
        fs: 'empty'
    }
};
